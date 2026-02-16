// backend/src/index.ts
// KobaFin POC backend (Fastify + Prisma + SIWS + testnet tx build)
// - Auth: Sign-In With Solana (challenge + verify)
// - Pots: create/list
// - Deposits: mock rails settlement
// - Allocation: returns a tx for Phantom to sign/send (testnet placeholder; later swap to Lulo tx)

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import nacl from "tweetnacl";
import bs58 from "bs58";
import crypto from "crypto";

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import { deriveVaultPdaFromPotId } from "./lib/escrow";
import {
  anchorDiscriminator,
  decodeInstructionData,
  parseEscrowInstructionData,
} from "./lib/escrow-tx";

// Node 18+ provides global `fetch`.

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

/**
 * IMPORTANT: If your package.json has "type": "commonjs", avoid top-level await.
 * We'll use an async main() boot function instead.
 */

const STRATEGY_META = {
  low: { strategyKey: "LULO_PROTECTED", riskTier: "LOW", luloMode: "PROTECTED" },
  med: { strategyKey: "LULO_PROTECTED", riskTier: "MED", luloMode: "PROTECTED" },
  high: { strategyKey: "LULO_BOOSTED", riskTier: "HIGH", luloMode: "BOOSTED" },
} as const;

const STRATEGIES = [
  {
    id: "low",
    name: "Low Risk",
    strategyKey: STRATEGY_META.low.strategyKey,
    riskTier: STRATEGY_META.low.riskTier,
    luloMode: STRATEGY_META.low.luloMode,
    allocations: { USDC: 0.7, BTC: 0.15, ETH: 0.1, SOL: 0.05 },
    execution: {
      USDC: { mode: "LULO_PROTECTED", note: "USDC → Lulo Protected (V1)" },
      BTC: { mode: "HOLD", note: "BTC held (V1)" },
      ETH: { mode: "HOLD", note: "ETH held (V1)" },
      SOL: { mode: "HOLD", note: "SOL held (V1)" },
    },
  },
  {
    id: "med",
    name: "Medium Risk",
    strategyKey: STRATEGY_META.med.strategyKey,
    riskTier: STRATEGY_META.med.riskTier,
    luloMode: STRATEGY_META.med.luloMode,
    allocations: { USDC: 0.4, BTC: 0.25, ETH: 0.2, SOL: 0.15 },
    execution: {
      USDC: {
        mode: "LULO_SPLIT",
        protectedPct: 0.7,
        boostedPct: 0.3,
        note: "USDC → Lulo Protected/Boosted split (V1)",
      },
      BTC: { mode: "HOLD", note: "BTC held (V1)" },
      ETH: { mode: "HOLD", note: "ETH held (V1)" },
      SOL: { mode: "HOLD", note: "SOL held (V1)" },
    },
  },
  {
    id: "high",
    name: "High Risk",
    strategyKey: STRATEGY_META.high.strategyKey,
    riskTier: STRATEGY_META.high.riskTier,
    luloMode: STRATEGY_META.high.luloMode,
    allocations: { USDC: 0.2, BTC: 0.3, ETH: 0.25, SOL: 0.25 },
    execution: {
      USDC: {
        mode: "LULO_SPLIT",
        protectedPct: 0.4,
        boostedPct: 0.6,
        note: "USDC → Lulo Protected/Boosted split (V1)",
      },
      BTC: { mode: "HOLD", note: "BTC held (V1)" },
      ETH: { mode: "HOLD", note: "ETH held (V1)" },
      SOL: { mode: "HOLD", note: "SOL held (V1)" },
    },
  },
] as const;

function resolveStrategyMeta(id: "low" | "med" | "high") {
  return STRATEGY_META[id] ?? STRATEGY_META.low;
}

type GovernancePodTier = "LOW" | "MEDIUM" | "HIGH";

function normalizePodTierFromPot(pot: { strategyId?: string; riskTier?: string | null }): GovernancePodTier {
  const risk = String(pot.riskTier || "").trim().toUpperCase();
  if (risk === "LOW") return "LOW";
  if (risk === "MED" || risk === "MEDIUM") return "MEDIUM";
  if (risk === "HIGH") return "HIGH";

  const strategyId = String(pot.strategyId || "").trim().toLowerCase();
  if (strategyId === "low") return "LOW";
  if (strategyId === "med" || strategyId === "medium") return "MEDIUM";
  return "HIGH";
}

function governanceWeightsPctFromStrategy(strategyId: string) {
  const strategy =
    STRATEGIES.find((s) => s.id === (strategyId as "low" | "med" | "high")) || STRATEGIES[0];
  return {
    usdc: Math.round((strategy.allocations.USDC || 0) * 10000) / 100,
    btc: Math.round((strategy.allocations.BTC || 0) * 10000) / 100,
    eth: Math.round(((strategy.allocations as any).ETH || 0) * 10000) / 100,
    sol: Math.round((strategy.allocations.SOL || 0) * 10000) / 100,
  };
}

function governancePolicyForTier(tier: GovernancePodTier) {
  if (tier === "LOW") {
    return {
      min_usdc_in_lulo_pct: 70,
      max_btc_pct: 20,
      max_eth_pct: 15,
      max_sol_pct: 15,
    };
  }
  if (tier === "MEDIUM") {
    return {
      min_usdc_in_lulo_pct: 50,
      max_btc_pct: 30,
      max_eth_pct: 25,
      max_sol_pct: 25,
    };
  }
  return {
    min_usdc_in_lulo_pct: 30,
    max_btc_pct: 40,
    max_eth_pct: 30,
    max_sol_pct: 40,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function randomNonce(bytes = 12) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeApiBase(raw: string) {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function parseCsvAllowlist(raw: string | undefined) {
  return String(raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeOriginValue(origin: string) {
  return origin.trim().replace(/\/$/, "").toLowerCase();
}

function corsOriginOptionFromAllowlist(allowlist: string[]) {
  const normalized = allowlist.map(normalizeOriginValue);
  return normalized.length ? normalized : true;
}

function isMainnetEndpoint(raw: string) {
  const v = (raw || "").toLowerCase();
  if (!v) return false;
  return !v.includes("devnet") && !v.includes("testnet") && !v.includes("localhost");
}

const MIN_DEPOSIT_USD = (() => {
  const v = Number(process.env.MIN_DEPOSIT_USD || 5);
  return Number.isFinite(v) && v > 0 ? v : 5;
})();
const RECOVERY_LOCK_HOURS = (() => {
  const v = Number(process.env.RECOVERY_LOCK_HOURS || 48);
  return Number.isFinite(v) && v > 0 ? v : 48;
})();
const LOCKED_WITHDRAW_FEE_BPS = (() => {
  const v = Number(process.env.LOCKED_WITHDRAW_FEE_BPS || 1500);
  return Number.isFinite(v) && v >= 0 ? v : 1500;
})();
const EMPTY_POT_USD_THRESHOLD = 0.01;
const SIWS_RATE_WINDOW_MS = (() => {
  const v = Number(process.env.SIWS_RATE_WINDOW_MS || 60_000);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
})();
const SIWS_RATE_MAX_REQUESTS = (() => {
  const v = Number(process.env.SIWS_RATE_MAX_REQUESTS || 25);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 25;
})();

const VAULT_SPACE = 8 + 32 + 32 + 1 + 32 + 32;
const SOL_USD_CACHE_TTL_MS = 30_000;
const ASSET_USD_CACHE_TTL_MS = 30_000;
const VAULT_RENT_CACHE_TTL_MS = 60_000;
let solUsdCache: { value: number; fetchedAt: number } | null = null;
let assetUsdCache: { value: Record<string, number>; fetchedAt: number } | null = null;
let vaultRentCache: { value: number; fetchedAt: number } | null = null;
const siwsRate = new Map<string, { count: number; resetAt: number }>();

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

async function getSolUsdPrice(): Promise<number> {
  // Coingecko is fine for a PoC. For production, use a paid oracle / exchange quote + caching.
  // Fallback avoids blocking local dev if rate-limited.
  const fallback = Number(process.env.SOL_USD_FALLBACK || 200);
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      {
        headers: { "accept": "application/json" },
      }
    );
    if (!res.ok) return fallback;
    const json: any = await res.json();
    const p = Number(json?.solana?.usd);
    return Number.isFinite(p) && p > 0 ? p : fallback;
  } catch {
    return fallback;
  }
}

async function getAssetUsdPrices(ids: string[]): Promise<Record<string, number>> {
  const fallback: Record<string, number> = {
    bitcoin: Number(process.env.BTC_USD_FALLBACK || 50000),
    ethereum: Number(process.env.ETH_USD_FALLBACK || 3000),
  };
  const normalized = ids.filter(Boolean);
  if (!normalized.length) return {};
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${normalized.join(",")}&vs_currencies=usd`,
      { headers: { accept: "application/json" } }
    );
    if (!res.ok) return fallback;
    const json: any = await res.json();
    const out: Record<string, number> = {};
    for (const id of normalized) {
      const v = Number(json?.[id]?.usd);
      out[id] = Number.isFinite(v) && v > 0 ? v : fallback[id] || 0;
    }
    return out;
  } catch {
    return fallback;
  }
}

async function getSolUsdPriceCached(): Promise<number> {
  const now = Date.now();
  if (solUsdCache && now - solUsdCache.fetchedAt < SOL_USD_CACHE_TTL_MS) return solUsdCache.value;
  const value = await getSolUsdPrice();
  solUsdCache = { value, fetchedAt: now };
  return value;
}

async function getAssetUsdPricesCached(ids: string[]): Promise<Record<string, number>> {
  const now = Date.now();
  if (assetUsdCache && now - assetUsdCache.fetchedAt < ASSET_USD_CACHE_TTL_MS) {
    return assetUsdCache.value;
  }
  const value = await getAssetUsdPrices(ids);
  assetUsdCache = { value, fetchedAt: now };
  return value;
}

function calcFeeLamports(lamports: number) {
  if (!Number.isFinite(lamports) || lamports <= 0) return 0;
  return Math.floor((lamports * LOCKED_WITHDRAW_FEE_BPS) / 10_000);
}

async function getVaultRentCached(connection: Connection): Promise<number> {
  const now = Date.now();
  if (vaultRentCache && now - vaultRentCache.fetchedAt < VAULT_RENT_CACHE_TTL_MS) {
    return vaultRentCache.value;
  }
  const value = await connection.getMinimumBalanceForRentExemption(VAULT_SPACE);
  vaultRentCache = { value, fetchedAt: now };
  return value;
}

function buildSiwsMessage(opts: {
  domain: string;
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  chain: string;
}) {
  return [
    `${opts.domain} wants you to sign in with your Solana account:`,
    `${opts.walletAddress}`,
    ``,
    `Statement: Sign in to KobaFin (POC).`,
    `Chain: ${opts.chain}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
  ].join("\n");
}

function verifySolanaMessageSignature(params: {
  walletAddress: string;
  message: string;
  signatureBase58: string;
}) {
  const pubkey = new PublicKey(params.walletAddress);
  const msgBytes = new TextEncoder().encode(params.message);
  const sigBytes = bs58.decode(params.signatureBase58);
  return nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes());
}

// JWT auth preHandler
async function authGuard(req: any, reply: any) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

// ========== ROUTES ==========
async function registerRoutes() {
  const corsAllowlist = parseCsvAllowlist(process.env.CORS_ALLOWED_ORIGINS);
  await app.register(cors, { origin: corsOriginOptionFromAllowlist(corsAllowlist) });
  await app.register(jwt, { secret: requireEnv("JWT_SECRET") });

  const connection = new Connection(requireEnv("SOLANA_RPC"), "confirmed");
  const escrowProgramId = new PublicKey(requireEnv("KOBA_ESCROW_PROGRAM_ID"));
  const luloProgramId = process.env.LULO_PROGRAM_ID
    ? new PublicKey(process.env.LULO_PROGRAM_ID)
    : null;
  const adminWallet = process.env.KOBA_ADMIN_WALLET
    ? new PublicKey(process.env.KOBA_ADMIN_WALLET)
    : null;
  const adminPotId = process.env.KOBA_ADMIN_POT_ID || "";
  const luloEnabled = !!luloProgramId;
  const luloApiBase = normalizeApiBase(process.env.LULO_API_BASE || "https://api.lulo.fi");
  const luloApiKey = process.env.LULO_API_KEY || "";
  const usdcMint = process.env.USDC_MINT ? new PublicKey(process.env.USDC_MINT) : null;
  const btcMint = process.env.BTC_MINT ? new PublicKey(process.env.BTC_MINT) : null;
  const ethMint = process.env.ETH_MINT ? new PublicKey(process.env.ETH_MINT) : null;
  const wsolMint = process.env.WSOL_MINT ? new PublicKey(process.env.WSOL_MINT) : null;
  const jupiterApiBase = normalizeApiBase(process.env.JUPITER_API_BASE || "https://api.jup.ag");
  const jupiterApiKey = process.env.JUPITER_API_KEY || "";
  const internalApiKey = process.env.INTERNAL_API_KEY || "";
  const allowAdminPotWithdrawals =
    String(process.env.ALLOW_ADMIN_POT_WITHDRAWALS || "false").toLowerCase() === "true";

  function ensureInternalAccess(req: any, reply: any) {
    if (!internalApiKey) return true;
    const provided = String(req.headers["x-internal-key"] || "");
    if (provided !== internalApiKey) {
      reply.code(401).send({ error: "unauthorized_internal" });
      return false;
    }
    return true;
  }

  function enforceSiwsRateLimit(req: any, reply: any) {
    const now = Date.now();
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const key = `siws:${ip}`;
    const entry = siwsRate.get(key);

    if (!entry || now >= entry.resetAt) {
      siwsRate.set(key, { count: 1, resetAt: now + SIWS_RATE_WINDOW_MS });
      return false;
    }

    if (entry.count >= SIWS_RATE_MAX_REQUESTS) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      reply
        .code(429)
        .header("retry-after", String(retryAfterSec))
        .send({ error: "rate_limited", retryAfterSec });
      return true;
    }

    entry.count += 1;
    siwsRate.set(key, entry);
    return false;
  }

  function isRestrictedAdminPot(potId: string) {
    if (allowAdminPotWithdrawals) return false;
    return !!adminPotId && potId === adminPotId;
  }

  function rejectRestrictedAdminPot(
    req: any,
    potId: string,
    reply: any,
    action: "withdraw" | "delete"
  ) {
    if (!isRestrictedAdminPot(potId)) return false;
    // Treasury owner can manage treasury pot from authenticated admin session.
    if (adminWallet && String(req?.user?.walletAddress || "") === adminWallet.toBase58()) {
      return false;
    }
    reply.code(403).send({
      error: "admin_pot_restricted",
      message:
        action === "withdraw"
          ? "Admin pot is treasury-managed and cannot be withdrawn from user flows."
          : "Admin pot is treasury-managed and cannot be deleted from user flows.",
    });
    return true;
  }

  // ----- HEALTH -----
  app.get("/health", async () => ({ ok: true }));

  // ----- STRATEGIES -----
  app.get("/v1/strategies", async () => ({ strategies: STRATEGIES }));

  // ----- GOVERNANCE POD SNAPSHOT (CRE input) -----
  app.get("/v1/governance/pods", async (req: any, reply) => {
    if (!ensureInternalAccess(req, reply)) return;
    const creRunId = String(req.headers["x-cre-run-id"] || "");
    if (creRunId) {
      app.log.info({ creRunId }, "governance_pods_requested");
    }

    const [pots, solUsd, assets] = await Promise.all([
      prisma.pot.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, strategyId: true, riskTier: true },
      }),
      getSolUsdPriceCached(),
      getAssetUsdPricesCached(["bitcoin", "ethereum"]),
    ]);

    const btcSpot =
      assets.bitcoin && assets.bitcoin > 0
        ? assets.bitcoin
        : Number(process.env.BTC_USD_FALLBACK || 50000);
    const ethSpot =
      assets.ethereum && assets.ethereum > 0
        ? assets.ethereum
        : Number(process.env.ETH_USD_FALLBACK || 3000);

    const pods = pots.map((pot) => {
      const podTier = normalizePodTierFromPot(pot);
      return {
        pod_id: pot.id,
        pod_tier: podTier,
        current_weights_pct: governanceWeightsPctFromStrategy(pot.strategyId || "low"),
        current_risk_state: "NORMAL" as const,
        policy: governancePolicyForTier(podTier),
        // DEX spot placeholders in USDC per asset (USDC ~= USD).
        dex_spot_prices: {
          btcb_usdc: btcSpot,
          weth_usdc: ethSpot,
          sol_usdc: solUsd,
        },
      };
    });

    if (creRunId) {
      app.log.info({ creRunId, podCount: pods.length }, "governance_pods_response");
    }
    return reply.send({ pods });
  });

  // ----- LULO STATUS -----
  const luloNetwork =
    (process.env.LULO_NETWORK || "").trim().toLowerCase() ||
    (luloApiBase.includes("api.lulo.fi") ? "mainnet" : "unknown");

  const LULO_RATES_TTL_MS = 60_000;
  let luloRatesCache: { value: any; expiresAt: number } | null = null;

  async function fetchLuloRates() {
    if (!luloApiKey) throw new Error("lulo_api_key_missing");
    const res = await fetch(`${luloApiBase}/v1/rates.getRates`, {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-api-key": luloApiKey,
      },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  app.get("/v1/lulo/status", async () => ({
    enabled: luloEnabled,
    programId: luloProgramId?.toBase58() ?? null,
    apiBase: luloApiBase,
    network: luloNetwork,
  }));

  app.get("/v1/lulo/rates", async (_req, reply) => {
    if (!luloApiKey) return reply.code(400).send({ error: "lulo_api_key_missing" });

    const now = Date.now();
    if (luloRatesCache && now < luloRatesCache.expiresAt) {
      return reply.send({ rates: luloRatesCache.value, cached: true });
    }

    try {
      const rates = await fetchLuloRates();
      luloRatesCache = { value: rates, expiresAt: now + LULO_RATES_TTL_MS };
      return reply.send({ rates, cached: false });
    } catch (err: any) {
      return reply.code(502).send({ error: err?.message || "lulo_rates_failed" });
    }
  });

  // ----- SIWS AUTH -----
  app.post("/v1/auth/siws/challenge", async (req, reply) => {
    if (enforceSiwsRateLimit(req, reply)) return;
    const body = z
      .object({
        walletAddress: z.string().min(32),
        domain: z.string().default("localhost"),
        chain: z.string().default("solana:devnet"),
      })
      .parse(req.body);

    // Validate pubkey format
    new PublicKey(body.walletAddress);

    const nonce = randomNonce(12);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    const message = buildSiwsMessage({
      domain: body.domain,
      walletAddress: body.walletAddress,
      nonce,
      issuedAt,
      chain: body.chain,
    });
    // Ensure user exists so FK on AuthChallenge.walletAddress won't fail
await prisma.user.upsert({
  where: { walletAddress: body.walletAddress },
  update: {},
  create: {
    walletAddress: body.walletAddress,
    // add any required defaults your schema needs:
    // email: null,
    // phone: null,
    // country: null,
  },
});

    await prisma.authChallenge.create({
      data: {
        walletAddress: body.walletAddress,
        nonce,
        message,
        expiresAt,
      },
    });

    return reply.send({ nonce, message, expiresAt: expiresAt.toISOString() });
  });

  app.post("/v1/auth/siws/verify", async (req, reply) => {
    if (enforceSiwsRateLimit(req, reply)) return;
    const body = z
      .object({
        walletAddress: z.string().min(32),
        nonce: z.string().min(10),
        message: z.string().min(10),
        signature: z.string().min(20), // base58
      })
      .parse(req.body);

    const ch = await prisma.authChallenge.findUnique({
      where: { nonce: body.nonce },
    });

    if (!ch) return reply.code(400).send({ error: "invalid_nonce" });
    if (ch.usedAt) return reply.code(400).send({ error: "nonce_used" });
    if (ch.walletAddress !== body.walletAddress)
      return reply.code(400).send({ error: "wallet_mismatch" });
    if (ch.message !== body.message)
      return reply.code(400).send({ error: "message_mismatch" });
    if (new Date() > ch.expiresAt)
      return reply.code(400).send({ error: "nonce_expired" });

    const ok = verifySolanaMessageSignature({
      walletAddress: body.walletAddress,
      message: body.message,
      signatureBase58: body.signature,
    });

    if (!ok) return reply.code(401).send({ error: "bad_signature" });

    // upsert user
    let user = await prisma.user.findUnique({
      where: { walletAddress: body.walletAddress },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { walletAddress: body.walletAddress },
      });
    }

    // mark nonce used
    await prisma.authChallenge.update({
      where: { nonce: body.nonce },
      data: { usedAt: new Date() },
    });

    // mint JWT
    const token = (app as any).jwt.sign({
      sub: user.id,
      walletAddress: user.walletAddress,
    });

    return reply.send({
      accessToken: token,
      user: { id: user.id, walletAddress: user.walletAddress },
    });
  });

  // ----- ME -----
  app.get("/v1/me", { preHandler: authGuard }, async (req: any) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return { user: null };
    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        recoveryMode: user.recoveryMode,
        recoveryLockedUntil: user.recoveryLockedUntil,
        recoveryUpdatedAt: user.recoveryUpdatedAt,
      },
    };
  });

  app.post("/v1/me/recovery", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const now = new Date();
    const lockedUntil = body.enabled
      ? new Date(now.getTime() + RECOVERY_LOCK_HOURS * 60 * 60 * 1000)
      : null;

    const user = await prisma.user.update({
      where: { id: req.user.sub },
      data: {
        recoveryMode: body.enabled,
        recoveryLockedUntil: lockedUntil,
        recoveryUpdatedAt: now,
      },
    });

    return reply.send({
      ok: true,
      recoveryMode: user.recoveryMode,
      recoveryLockedUntil: user.recoveryLockedUntil,
      recoveryUpdatedAt: user.recoveryUpdatedAt,
    });
  });

  // ----- POTS -----
  app.post("/v1/pots", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z
      .object({
        name: z.string().min(1),
        strategyId: z.enum(["low", "med", "high"]),
        goalUsd: z.number().positive().optional(),
        isLocked: z.boolean().optional(),
      })
      .parse(req.body);

    const strategyMeta = resolveStrategyMeta(body.strategyId);

    const pot = await prisma.pot.create({
      data: {
        userId: req.user.sub,
        name: body.name,
        strategyId: body.strategyId,
        strategyKey: strategyMeta.strategyKey,
        riskTier: strategyMeta.riskTier,
        goalUsd: body.goalUsd ?? null,
        isLocked: body.isLocked ?? false,
      },
    });

    try {
      const owner = new PublicKey(req.user.walletAddress);
      const { pda: vaultPda } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);
      await prisma.luloPosition.create({
        data: {
          potId: pot.id,
          userId: req.user.sub,
          strategyKey: strategyMeta.strategyKey,
          riskTier: strategyMeta.riskTier,
          status: "UNALLOCATED",
          vaultPda: vaultPda.toBase58(),
          luloProgramId: luloProgramId?.toBase58() ?? null,
        },
      });
    } catch (err) {
      // Non-fatal: pot creation should still succeed even if Lulo position init fails.
      app.log.warn({ err }, "lulo_position_init_failed");
    }

    // Return both shapes to keep the POC flexible
    return reply.send({ potId: pot.id, pot: { id: pot.id } });
  });

  app.get("/v1/pots", { preHandler: authGuard }, async (req: any) => {
    const pots = await prisma.pot.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "desc" },
    });
    const enriched = pots.map((p) => {
      const meta = resolveStrategyMeta((p.strategyId as "low" | "med" | "high") || "low");
      return {
        ...p,
        strategyKey: p.strategyKey ?? meta.strategyKey,
        riskTier: p.riskTier ?? meta.riskTier,
      };
    });
    return { pots: enriched };
  });

  // ----- DASHBOARD (TOTAL + PER-POT BALANCES) -----
  // Computes balances from on-chain per-pot vault PDA lamports.
  app.get("/v1/dashboard", { preHandler: authGuard }, async (req: any) => {
    const pots = await prisma.pot.findMany({
      where: { userId: req.user.sub },
      orderBy: { createdAt: "desc" },
    });

    const owner = new PublicKey(req.user.walletAddress);
    const minRent = await getVaultRentCached(connection);
    const solUsd = await getSolUsdPriceCached();

    const vaults = pots.map((p) => {
      const { pda: vaultPda } = deriveVaultPdaFromPotId(owner, p.id, escrowProgramId);
      return { pot: p, vaultPda };
    });

    const accounts = vaults.length
      ? await connection.getMultipleAccountsInfo(
          vaults.map((v) => v.vaultPda),
          "confirmed"
        )
      : [];

    const enriched = vaults.map((v, i) => {
      const info = accounts[i];
      const bal = info?.lamports || 0;
      const availableLamports = Math.max(0, bal - minRent);
      const sol = availableLamports / LAMPORTS_PER_SOL;
      const usd = sol * solUsd;
      const cashUsd = usd;
      const investedUsd = 0;
      return {
        ...v.pot,
        vaultPda: v.vaultPda.toBase58(),
        balanceLamports: availableLamports,
        balanceSol: sol,
        balanceUsd: usd,
        cashUsd,
        investedUsd,
        totalUsd: cashUsd + investedUsd,
      };
    });

    const totalUsd = enriched.reduce((sum, p) => sum + (p.totalUsd || 0), 0);
    const cashUsd = enriched.reduce((sum, p) => sum + (p.cashUsd || 0), 0);
    const investedUsd = enriched.reduce((sum, p) => sum + (p.investedUsd || 0), 0);
    return { totalUsd, cashUsd, investedUsd, solUsd, pots: enriched };
  });

  // ----- POT DETAILS -----
  app.get("/v1/pots/:potId", { preHandler: authGuard }, async (req: any, reply) => {
    const potId = req.params.potId as string;
    const pot = await prisma.pot.findFirst({ where: { id: potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });
    const owner = new PublicKey(req.user.walletAddress);
    const { pda: vaultPda } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);
    const minRent = await getVaultRentCached(connection);
    const solUsd = await getSolUsdPriceCached();
    const bal = await connection.getBalance(vaultPda, "confirmed");
    const availableLamports = Math.max(0, bal - minRent);
    const balanceSol = availableLamports / LAMPORTS_PER_SOL;
    const balanceUsd = balanceSol * solUsd;

    const strategyMeta = resolveStrategyMeta(
      (pot.strategyId as "low" | "med" | "high") || "low"
    );
    const potOut = {
      ...pot,
      strategyKey: pot.strategyKey ?? strategyMeta.strategyKey,
      riskTier: pot.riskTier ?? strategyMeta.riskTier,
    };

    return {
      pot: potOut,
      vaultPda: vaultPda.toBase58(),
      balanceLamports: availableLamports,
      balanceSol,
      balanceUsd,
      solUsd,
    };
  });

  // ----- LULO POSITION (per pot) -----
  app.get("/v1/pots/:potId/lulo", { preHandler: authGuard }, async (req: any, reply) => {
    const potId = req.params.potId as string;
    const pot = await prisma.pot.findFirst({ where: { id: potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    let position = await prisma.luloPosition.findUnique({ where: { potId } });
    if (!position) {
      const strategyMeta = resolveStrategyMeta(
        (pot.strategyId as "low" | "med" | "high") || "low"
      );
      const owner = new PublicKey(req.user.walletAddress);
      const { pda: vaultPda } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);
      position = await prisma.luloPosition.create({
        data: {
          potId: pot.id,
          userId: req.user.sub,
          strategyKey: pot.strategyKey || strategyMeta.strategyKey,
          riskTier: pot.riskTier || strategyMeta.riskTier,
          status: "UNALLOCATED",
          vaultPda: vaultPda.toBase58(),
          luloProgramId: luloProgramId?.toBase58() ?? null,
        },
      });
    }

    const ops = await prisma.luloOp.findMany({
      where: { potId, userId: req.user.sub },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return {
      enabled: luloEnabled,
      programId: luloProgramId?.toBase58() ?? null,
      position,
      ops,
    };
  });

  // ----- DELETE POT -----
  // V1: delete deposits linked to pot, then delete pot
  app.delete(
    "/v1/pots/:potId",
    { preHandler: authGuard },
    async (req: any, reply) => {
      const potId = req.params.potId as string;
      if (rejectRestrictedAdminPot(req, potId, reply, "delete")) return;
      const pot = await prisma.pot.findFirst({ where: { id: potId, userId: req.user.sub } });
      if (!pot) return reply.code(404).send({ error: "pot_not_found" });

      // Only allow deleting pots that are effectively empty (< $0.01).
      try {
        const owner = new PublicKey(req.user.walletAddress);
        const { pda: vaultPda } = deriveVaultPdaFromPotId(owner, potId, escrowProgramId);
        const vaultInfo = await connection.getAccountInfo(vaultPda, "confirmed");
        let totalUsd = 0;

        if (vaultInfo) {
          const rent = await getVaultRentCached(connection);
          const availableLamports = Math.max(0, vaultInfo.lamports - rent);
          if (availableLamports > 0) {
            const solUsd = await getSolUsdPriceCached();
            totalUsd += (availableLamports / LAMPORTS_PER_SOL) * solUsd;
          }
        }

        const getTokenUiAmount = async (ata: PublicKey) => {
          try {
            const bal = await connection.getTokenAccountBalance(ata, "confirmed");
            const ui = bal?.value?.uiAmount;
            return Number.isFinite(ui as number) ? (ui as number) : 0;
          } catch {
            return 0;
          }
        };

        if (usdcMint) {
          const usdcAta = getAta(vaultPda, usdcMint);
          const usdcUi = await getTokenUiAmount(usdcAta);
          totalUsd += usdcUi;
        }

        const needsBtc = !!btcMint;
        const needsEth = !!ethMint;
        const prices = needsBtc || needsEth
          ? await getAssetUsdPricesCached([
              needsBtc ? "bitcoin" : "",
              needsEth ? "ethereum" : "",
            ])
          : {};

        if (btcMint) {
          const btcAta = getAta(vaultPda, btcMint);
          const btcUi = await getTokenUiAmount(btcAta);
          const btcUsd = prices.bitcoin || 0;
          totalUsd += btcUi * btcUsd;
        }

        if (ethMint) {
          const ethAta = getAta(vaultPda, ethMint);
          const ethUi = await getTokenUiAmount(ethAta);
          const ethUsd = prices.ethereum || 0;
          totalUsd += ethUi * ethUsd;
        }

        if (wsolMint) {
          const wsolAta = getAta(vaultPda, wsolMint);
          const wsolUi = await getTokenUiAmount(wsolAta);
          if (wsolUi > 0) {
            const solUsd = await getSolUsdPriceCached();
            totalUsd += wsolUi * solUsd;
          }
        }

        if (totalUsd >= EMPTY_POT_USD_THRESHOLD) {
          return reply.code(400).send({
            error: "pot_not_empty",
            balanceUsd: Number(totalUsd.toFixed(4)),
            thresholdUsd: EMPTY_POT_USD_THRESHOLD,
          });
        }
      } catch (err) {
        return reply.code(503).send({ error: "rpc_unavailable" });
      }

      await prisma.$transaction([
        prisma.luloOp.deleteMany({ where: { potId, userId: req.user.sub } }),
        prisma.luloPosition.deleteMany({ where: { potId, userId: req.user.sub } }),
        prisma.deposit.deleteMany({ where: { potId, userId: req.user.sub } }),
        prisma.pot.delete({ where: { id: potId } }),
      ]);

      return reply.send({ ok: true });
    }
  );

  // ----- POT DEPOSITS -----
  app.get(
    "/v1/pots/:potId/deposits",
    { preHandler: authGuard },
    async (req: any, reply) => {
      const potId = req.params.potId as string;
      const pot = await prisma.pot.findFirst({ where: { id: potId, userId: req.user.sub } });
      if (!pot) return reply.code(404).send({ error: "pot_not_found" });

      const deposits = await prisma.deposit.findMany({
        where: {
          potId,
          userId: req.user.sub,
          status: { in: ["MOCK_SETTLED", "SOL_CONFIRMED", "WITHDRAW_CONFIRMED", "ALLOC_CONFIRMED", "FEE_CONFIRMED"] },
        },
        orderBy: { createdAt: "desc" },
      });

      const totalUsdc = deposits.reduce((acc, d) => acc + d.netUsdc, 0);
      return { deposits, totalUsdc };
    }
  );

  // ----- MOCK DEPOSIT (simulates rails settlement) -----
  app.post("/v1/deposits/mock", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string(), netUsdc: z.number().positive() }).parse(req.body);
    if (body.netUsdc < MIN_DEPOSIT_USD) {
      return reply.code(400).send({ error: "min_deposit", minUsd: MIN_DEPOSIT_USD });
    }

    const pot = await prisma.pot.findFirst({
      where: { id: body.potId, userId: req.user.sub },
    });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const dep = await prisma.deposit.create({
      data: {
        userId: req.user.sub,
        potId: body.potId,
        netUsdc: body.netUsdc,
        amountLamports: null,
        status: "MOCK_SETTLED",
      },
    });

    return reply.send({ depositId: dep.id, status: dep.status });
  });

  // ----- USDC DEPOSIT (Vault custody) -----
  app.post("/v1/deposits/usdc/prepare", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string().min(1), usd: z.number().positive() }).parse(req.body);
    if (body.usd < MIN_DEPOSIT_USD) {
      return reply.code(400).send({ error: "min_deposit", minUsd: MIN_DEPOSIT_USD });
    }
    if (!usdcMint) return reply.code(400).send({ error: "usdc_mint_missing" });

    const pot = await prisma.pot.findFirst({ where: { id: body.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const owner = new PublicKey(req.user.walletAddress);
    const { pda: vaultPda, potHash } = deriveVaultPdaFromPotId(owner, body.potId, escrowProgramId);
    const userUsdc = getAta(owner, usdcMint);
    const vaultUsdc = getAta(vaultPda, usdcMint);

    const usdcBaseUnits = Math.round(body.usd * 1_000_000);
    if (!Number.isFinite(usdcBaseUnits) || usdcBaseUnits <= 0) {
      return reply.code(400).send({ error: "invalid_amount" });
    }

    const dep = await prisma.deposit.create({
      data: {
        userId: req.user.sub,
        potId: body.potId,
        netUsdc: body.usd,
        amountLamports: String(usdcBaseUnits),
        status: `USDC_PENDING:${usdcBaseUnits}`,
      },
    });

    const latest = await connection.getLatestBlockhash("finalized");
    const tx = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash });

    const acct = await connection.getAccountInfo(vaultPda, "confirmed");
    if (acct && acct.data && acct.data.length < VAULT_SPACE) {
      return reply.code(400).send({ error: "vault_upgrade_required" });
    }
    if (!acct) {
      const data = Buffer.concat([anchorDiscriminator("init_pot_vault"), potHash]);
      tx.add(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: usdcMint, isSigner: false, isWritable: false },
            { pubkey: vaultUsdc, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        })
      );
    }

    const depositData = Buffer.concat([
      anchorDiscriminator("deposit_usdc"),
      potHash,
      u64le(usdcBaseUnits),
    ]);
    tx.add(
      new TransactionInstruction({
        programId: escrowProgramId,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: usdcMint, isSigner: false, isWritable: false },
          { pubkey: userUsdc, isSigner: false, isWritable: true },
          { pubkey: vaultUsdc, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: depositData,
      })
    );

    const txBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
    return reply.send({
      depositId: dep.id,
      usd: body.usd,
      usdcBaseUnits,
      vaultPda: vaultPda.toBase58(),
      vaultUsdc: vaultUsdc.toBase58(),
      txBase64,
      note: "Sign this tx to deposit USDC into your vault.",
    });
  });

  app.post("/v1/deposits/usdc/confirm", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ depositId: z.string().min(1), signature: z.string().min(20) }).parse(req.body);

    const dep = await prisma.deposit.findFirst({ where: { id: body.depositId, userId: req.user.sub } });
    if (!dep) return reply.code(404).send({ error: "deposit_not_found" });

    const status = String(dep.status);
    if (status === "USDC_CONFIRMED") {
      if (dep.txSig && dep.txSig !== body.signature) return reply.code(400).send({ error: "signature_mismatch" });
      return reply.send({ ok: true, status: "USDC_CONFIRMED", signature: dep.txSig || body.signature });
    }
    if (!status.startsWith("USDC_PENDING:")) {
      return reply.code(400).send({ error: "invalid_state", status });
    }

    const expectedLamports = Number(status.split(":")[1] || 0);
    if (!Number.isFinite(expectedLamports) || expectedLamports <= 0) {
      return reply.code(400).send({ error: "deposit_missing_quote" });
    }

    const owner = new PublicKey(req.user.walletAddress);
    const { pda, potHash: expectedPotHash } = deriveVaultPdaFromPotId(owner, dep.potId, escrowProgramId);

    const tx = await connection.getTransaction(body.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return reply.code(400).send({ error: "tx_not_found" });
    if (tx.meta?.err) return reply.code(400).send({ error: "tx_failed" });

    const msg = tx.transaction.message;
    const { matches } = matchEscrowInstruction({
      msg,
      expectedDiscriminator: anchorDiscriminator("deposit_usdc"),
      expectedPda: pda,
    });
    if (matches.length === 0) return reply.code(400).send({ error: "escrow_ix_missing" });
    if (matches.length > 1) return reply.code(400).send({ error: "escrow_ix_multiple" });

    let parsed: { potHash: Uint8Array; lamports: bigint; feeLamports: bigint | null };
    try {
      parsed = parseEscrowInstructionData(matches[0].data);
    } catch {
      return reply.code(400).send({ error: "escrow_ix_invalid" });
    }

    if (!Buffer.from(parsed.potHash).equals(Buffer.from(expectedPotHash))) {
      return reply.code(400).send({ error: "escrow_pot_mismatch" });
    }

    const expectedLamportsBig = BigInt(expectedLamports);
    if (parsed.lamports !== expectedLamportsBig) {
      return reply
        .code(400)
        .send({ error: "escrow_amount_mismatch", expectedLamports, actualLamports: parsed.lamports.toString() });
    }

    await prisma.deposit.update({
      where: { id: dep.id },
      data: { status: "USDC_CONFIRMED", txSig: body.signature },
    });

    return reply.send({ ok: true, status: "USDC_CONFIRMED", signature: body.signature });
  });

  // ----- SPLIT ALLOCATION (single tx: vault + Lulo + Jupiter) -----
  app.post("/v1/deposits/allocate/prepare", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string().min(1), usd: z.number().positive() }).parse(req.body);
    if (body.usd < MIN_DEPOSIT_USD) {
      return reply.code(400).send({ error: "min_deposit", minUsd: MIN_DEPOSIT_USD });
    }
    if (!usdcMint) return reply.code(400).send({ error: "usdc_mint_missing" });
    if (!btcMint) return reply.code(400).send({ error: "btc_mint_missing" });
    if (!ethMint) return reply.code(400).send({ error: "eth_mint_missing" });
    if (!wsolMint) return reply.code(400).send({ error: "wsol_mint_missing" });
    if (!luloEnabled) return reply.code(400).send({ error: "lulo_not_configured" });
    if (!isMainnetEndpoint(connection.rpcEndpoint)) {
      return reply.code(400).send({ error: "mainnet_required" });
    }
    if (jupiterApiBase.includes("api.jup.ag") && !jupiterApiKey) {
      return reply.code(400).send({ error: "jupiter_api_key_missing" });
    }

    const pot = await prisma.pot.findFirst({ where: { id: body.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const strategy = STRATEGIES.find((s) => s.id === pot.strategyId) || STRATEGIES[0];
    const allocations = strategy.allocations as Record<string, number>;

    const totalBase = Math.round(body.usd * 1_000_000);
    if (!Number.isFinite(totalBase) || totalBase <= 0) {
      return reply.code(400).send({ error: "invalid_amount" });
    }

    let usdcBase = Math.floor(totalBase * (allocations.USDC || 0));
    const btcBase = Math.floor(totalBase * (allocations.BTC || 0));
    const ethBase = Math.floor(totalBase * (allocations.ETH || 0));
    const solBase = Math.floor(totalBase * (allocations.SOL || 0));
    const allocatedSum = usdcBase + btcBase + ethBase + solBase;
    if (allocatedSum < totalBase) {
      usdcBase += totalBase - allocatedSum;
    }

    const owner = new PublicKey(req.user.walletAddress);
    const { pda: vaultPda, potHash } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);
    const vaultUsdc = getAta(vaultPda, usdcMint);
    const vaultBtc = getAta(vaultPda, btcMint);
    const vaultEth = getAta(vaultPda, ethMint);
    const vaultSol = getAta(vaultPda, wsolMint);

    const instructions: TransactionInstruction[] = [];
    const luloSetup: TransactionInstruction[] = [];
    const luloCompute: TransactionInstruction[] = [];
    const luloExecute: TransactionInstruction[] = [];
    const jupSetup: TransactionInstruction[] = [];
    const jupCompute: TransactionInstruction[] = [];
    const jupSwap: TransactionInstruction[] = [];
    const jupCleanup: TransactionInstruction[] = [];
    const lookupAddresses = new Set<string>();

    const vaultInfo = await connection.getAccountInfo(vaultPda, "confirmed");
    if (vaultInfo && vaultInfo.data && vaultInfo.data.length < VAULT_SPACE) {
      return reply.code(400).send({ error: "vault_upgrade_required" });
    }
    if (!vaultInfo) {
      const data = Buffer.concat([anchorDiscriminator("init_pot_vault"), potHash]);
      instructions.push(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: usdcMint, isSigner: false, isWritable: false },
            { pubkey: vaultUsdc, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        })
      );
    }

    const ataTargets = [
      { ata: vaultUsdc, mint: usdcMint },
      { ata: vaultBtc, mint: btcMint },
      { ata: vaultEth, mint: ethMint },
      { ata: vaultSol, mint: wsolMint },
    ];
    for (const target of ataTargets) {
      const info = await connection.getAccountInfo(target.ata, "confirmed");
      if (!info) {
        instructions.push(
          createAtaIx({
            payer: owner,
            ata: target.ata,
            owner: vaultPda,
            mint: target.mint,
          })
        );
      }
    }

    if (usdcBase > 0) {
      const depositData = Buffer.concat([
        anchorDiscriminator("deposit_usdc"),
        potHash,
        u64le(usdcBase),
      ]);
      instructions.push(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: usdcMint, isSigner: false, isWritable: false },
            { pubkey: getAta(owner, usdcMint), isSigner: false, isWritable: true },
            { pubkey: vaultUsdc, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: depositData,
        })
      );

      const luloAmount = usdcBase / 1_000_000;
      const meta = resolveStrategyMeta((pot.strategyId as "low" | "med" | "high") || "low");
      const protectedAmount = meta.luloMode === "PROTECTED" ? luloAmount : 0;
      const regularAmount = meta.luloMode === "BOOSTED" ? luloAmount : 0;

      if (luloAmount > 0) {
        const luloRes = await fetchLulo("/v1/generate.instructions.deposit", {
          owner: vaultPda.toBase58(),
          feePayer: owner.toBase58(),
          mintAddress: usdcMint.toBase58(),
          regularAmount,
          protectedAmount,
          referrer: process.env.LULO_REFERRER || undefined,
        });

        const ixGroup = luloRes?.instructions || {};

        const pushNativeIx = (ix: any, out: TransactionInstruction[]) => {
          if (!ix) return;
          const keys = toLuloKeys(ix.keys || [], vaultPda);
          out.push(
            new TransactionInstruction({
              programId: new PublicKey(ix.programId),
              keys,
              data: decodeLuloIxData(ix.data),
            })
          );
        };

        (ixGroup.computeBudgetInstructions || []).forEach((ix: any) => pushNativeIx(ix, luloCompute));
        (ixGroup.setupInstructions || []).forEach((ix: any) => pushNativeIx(ix, luloSetup));

        const makeVaultLuloIx = (ix: any) => {
          if (!ix) return;
          const luloKeys = toLuloKeys(ix.keys || [], vaultPda);
          const data = encodeLuloExecuteData(potHash, decodeLuloIxData(ix.data));
          luloExecute.push(
            new TransactionInstruction({
              programId: escrowProgramId,
              keys: [
                { pubkey: owner, isSigner: true, isWritable: false },
                { pubkey: vaultPda, isSigner: false, isWritable: true },
                { pubkey: luloProgramId!, isSigner: false, isWritable: false },
                ...luloKeys,
              ],
              data,
            })
          );
        };

        if (ixGroup.protectedDepositInstruction) {
          makeVaultLuloIx(ixGroup.protectedDepositInstruction);
        }
        if (ixGroup.regularDepositInstruction) {
          makeVaultLuloIx(ixGroup.regularDepositInstruction);
        }

        (ixGroup.addressLookupTableAddresses || []).forEach((addr: string) =>
          lookupAddresses.add(addr)
        );
      }
    }

    const swapPlans = [
      { label: "BTC", mint: btcMint, amount: btcBase, vaultAta: vaultBtc },
      { label: "ETH", mint: ethMint, amount: ethBase, vaultAta: vaultEth },
      { label: "SOL", mint: wsolMint, amount: solBase, vaultAta: vaultSol },
    ];

    for (const plan of swapPlans) {
      if (!plan.amount || plan.amount <= 0) continue;
      const quote = await fetchJupiterQuote({
        inputMint: usdcMint,
        outputMint: plan.mint,
        amount: plan.amount,
      });
      const swapRes = await fetchJupiterSwapInstructions({
        quoteResponse: quote,
        userPublicKey: owner.toBase58(),
        destinationTokenAccount: plan.vaultAta.toBase58(),
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: true,
        skipUserAccountsRpcCalls: true,
      });

      (swapRes?.computeBudgetInstructions || []).forEach((ix: any) => {
        const inst = jupiterIxToInstruction(ix);
        if (inst) jupCompute.push(inst);
      });
      (swapRes?.setupInstructions || []).forEach((ix: any) => {
        const inst = jupiterIxToInstruction(ix);
        if (inst) jupSetup.push(inst);
      });

      (swapRes?.otherInstructions || []).forEach((ix: any) => {
        const inst = jupiterIxToInstruction(ix);
        if (inst) jupSwap.push(inst);
      });

      const swapIx = jupiterIxToInstruction(swapRes?.swapInstruction || swapRes?.swapIx);
      if (swapIx) jupSwap.push(swapIx);

      const cleanupIx = jupiterIxToInstruction(swapRes?.cleanupInstruction);
      if (cleanupIx) jupCleanup.push(cleanupIx);

      (swapRes?.addressLookupTableAddresses || []).forEach((addr: string) =>
        lookupAddresses.add(addr)
      );
    }

    const dedupeCompute = (items: TransactionInstruction[]) => {
      const seen = new Set<string>();
      const out: TransactionInstruction[] = [];
      for (const ix of items) {
        const key = `${ix.programId.toBase58()}:${ix.data.toString("base64")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ix);
      }
      return out;
    };

    const finalInstructions: TransactionInstruction[] = [];
    finalInstructions.push(...dedupeCompute([...jupCompute, ...luloCompute]));
    finalInstructions.push(...instructions);
    finalInstructions.push(...luloSetup);
    finalInstructions.push(...luloExecute);
    finalInstructions.push(...jupSetup);
    finalInstructions.push(...jupSwap);
    finalInstructions.push(...jupCleanup);

    if (finalInstructions.length === 0) {
      return reply.code(400).send({ error: "no_instructions" });
    }

    const latest = await connection.getLatestBlockhash("finalized");
    const lookupList = Array.from(lookupAddresses);
    let txBase64 = "";
    let txVersion: "legacy" | "v0" = "legacy";

    if (lookupList.length) {
      const lookups = await Promise.all(
        lookupList.map((addr) => connection.getAddressLookupTable(new PublicKey(addr)))
      );
      const tables: AddressLookupTableAccount[] = lookups
        .map((l) => l.value)
        .filter((v): v is AddressLookupTableAccount => !!v);
      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: latest.blockhash,
        instructions: finalInstructions,
      }).compileToV0Message(tables);
      const vtx = new VersionedTransaction(msg);
      txBase64 = Buffer.from(vtx.serialize()).toString("base64");
      txVersion = "v0";
    } else {
      const tx = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash });
      finalInstructions.forEach((ix) => tx.add(ix));
      txBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
      txVersion = "legacy";
    }

    const dep = await prisma.deposit.create({
      data: {
        userId: req.user.sub,
        potId: pot.id,
        netUsdc: body.usd,
        amountLamports: String(totalBase),
        status: "ALLOC_PENDING",
      },
    });

    const luloOp =
      usdcBase > 0
        ? await prisma.luloOp.create({
            data: {
              potId: pot.id,
              userId: req.user.sub,
              depositId: dep.id,
              type: "ALLOCATE",
              amountLamports: String(usdcBase),
              status: "TX_READY",
            },
          })
        : null;

    return reply.send({
      depositId: dep.id,
      luloOpId: luloOp?.id ?? null,
      txBase64,
      txVersion,
      allocations: {
        usdc: usdcBase / 1_000_000,
        btc: btcBase / 1_000_000,
        eth: ethBase / 1_000_000,
        sol: solBase / 1_000_000,
      },
      vaultPda: vaultPda.toBase58(),
    });
  });

  app.post("/v1/deposits/allocate/confirm", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z
      .object({
        depositId: z.string().min(1),
        signature: z.string().min(20),
        luloOpId: z.string().min(1).optional(),
      })
      .parse(req.body);

    const dep = await prisma.deposit.findFirst({ where: { id: body.depositId, userId: req.user.sub } });
    if (!dep) return reply.code(404).send({ error: "deposit_not_found" });

    const tx = await connection.getTransaction(body.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return reply.code(400).send({ error: "tx_not_found" });
    if (tx.meta?.err) return reply.code(400).send({ error: "tx_failed" });

    await prisma.deposit.update({
      where: { id: dep.id },
      data: { status: "ALLOC_CONFIRMED", txSig: body.signature },
    });

    if (body.luloOpId) {
      await prisma.luloOp.update({
        where: { id: body.luloOpId },
        data: { status: "CONFIRMED", txSig: body.signature },
      });
    }

    return reply.send({ ok: true, status: "ALLOC_CONFIRMED", signature: body.signature });
  });

  // ----- LULO ALLOCATE (vault -> Lulo) -----
  app.post("/v1/lulo/deposits/prepare", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string().min(1), usd: z.number().positive() }).parse(req.body);
    if (body.usd < MIN_DEPOSIT_USD) {
      return reply.code(400).send({ error: "min_deposit", minUsd: MIN_DEPOSIT_USD });
    }
    if (!luloEnabled) return reply.code(400).send({ error: "lulo_not_configured" });
    if (!usdcMint) return reply.code(400).send({ error: "usdc_mint_missing" });

    const pot = await prisma.pot.findFirst({ where: { id: body.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const owner = new PublicKey(req.user.walletAddress);
    const { pda: vaultPda, potHash } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);
    const meta = resolveStrategyMeta((pot.strategyId as "low" | "med" | "high") || "low");
    const vaultInfo = await connection.getAccountInfo(vaultPda, "confirmed");
    if (!vaultInfo) return reply.code(400).send({ error: "vault_not_initialized" });
    if (vaultInfo.data && vaultInfo.data.length < VAULT_SPACE) {
      return reply.code(400).send({ error: "vault_upgrade_required" });
    }

    const protectedAmount = meta.luloMode === "PROTECTED" ? body.usd : 0;
    const regularAmount = meta.luloMode === "BOOSTED" ? body.usd : 0;

    const luloRes = await fetchLulo("/v1/generate.instructions.deposit", {
      owner: vaultPda.toBase58(),
      feePayer: owner.toBase58(),
      mintAddress: usdcMint.toBase58(),
      regularAmount,
      protectedAmount,
      referrer: process.env.LULO_REFERRER || undefined,
    });

    const instructions: TransactionInstruction[] = [];
    const ixGroup = luloRes?.instructions || {};

    const pushNativeIx = (ix: any) => {
      if (!ix) return;
      const keys = toLuloKeys(ix.keys || [], vaultPda);
      instructions.push(
        new TransactionInstruction({
          programId: new PublicKey(ix.programId),
          keys,
          data: decodeLuloIxData(ix.data),
        })
      );
    };

    (ixGroup.computeBudgetInstructions || []).forEach(pushNativeIx);
    (ixGroup.setupInstructions || []).forEach(pushNativeIx);

    const makeVaultLuloIx = (ix: any) => {
      if (!ix) return;
      const luloKeys = toLuloKeys(ix.keys || [], vaultPda);
      const data = encodeLuloExecuteData(potHash, decodeLuloIxData(ix.data));
      instructions.push(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: luloProgramId!, isSigner: false, isWritable: false },
            ...luloKeys,
          ],
          data,
        })
      );
    };

    if (ixGroup.protectedDepositInstruction) {
      makeVaultLuloIx(ixGroup.protectedDepositInstruction);
    }
    if (ixGroup.regularDepositInstruction) {
      makeVaultLuloIx(ixGroup.regularDepositInstruction);
    }

    const latest = await connection.getLatestBlockhash("finalized");
    const lookupAddresses: string[] = ixGroup.addressLookupTableAddresses || [];
    if (lookupAddresses.length) {
      const lookups = await Promise.all(
        lookupAddresses.map((addr: string) =>
          connection.getAddressLookupTable(new PublicKey(addr))
        )
      );
      const tables: AddressLookupTableAccount[] = lookups
        .map((l) => l.value)
        .filter((v): v is AddressLookupTableAccount => !!v);
      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: latest.blockhash,
        instructions,
      }).compileToV0Message(tables);
      const vtx = new VersionedTransaction(msg);
      const txBase64 = Buffer.from(vtx.serialize()).toString("base64");
      const op = await prisma.luloOp.create({
        data: {
          potId: pot.id,
          userId: req.user.sub,
          type: "ALLOCATE",
          amountLamports: String(Math.round(body.usd * 1_000_000)),
          status: "TX_READY",
        },
      });
      return reply.send({
        txBase64,
        txVersion: "v0",
        mode: meta.luloMode,
        luloOpId: op.id,
        step: "deposit",
      });
    }

    const tx = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash });
    instructions.forEach((ix) => tx.add(ix));
    const txBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
    const op = await prisma.luloOp.create({
      data: {
        potId: pot.id,
        userId: req.user.sub,
        type: "ALLOCATE",
        amountLamports: String(Math.round(body.usd * 1_000_000)),
        status: "TX_READY",
      },
    });
    return reply.send({
      txBase64,
      txVersion: "legacy",
      mode: meta.luloMode,
      luloOpId: op.id,
      step: "deposit",
    });
  });

  app.post("/v1/lulo/deposits/confirm", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z
      .object({ luloOpId: z.string().min(1), signature: z.string().min(20) })
      .parse(req.body);

    const op = await prisma.luloOp.findFirst({ where: { id: body.luloOpId, userId: req.user.sub } });
    if (!op) return reply.code(404).send({ error: "lulo_op_not_found" });
    if (op.status === "CONFIRMED") {
      if (op.txSig && op.txSig !== body.signature) {
        return reply.code(400).send({ error: "signature_mismatch" });
      }
      return reply.send({ ok: true, status: op.status, signature: op.txSig || body.signature });
    }

    const pot = await prisma.pot.findFirst({ where: { id: op.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const owner = new PublicKey(req.user.walletAddress);
    const { pda } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);

    const tx = await connection.getTransaction(body.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return reply.code(400).send({ error: "tx_not_found" });
    if (tx.meta?.err) return reply.code(400).send({ error: "tx_failed" });

    const msg = tx.transaction.message;
    const { matches } = matchEscrowInstruction({
      msg,
      expectedDiscriminator: anchorDiscriminator("lulo_execute"),
      expectedPda: pda,
    });
    if (matches.length === 0) return reply.code(400).send({ error: "escrow_ix_missing" });

    await prisma.luloOp.update({
      where: { id: op.id },
      data: { status: "CONFIRMED", txSig: body.signature },
    });

    return reply.send({ ok: true, status: "CONFIRMED", signature: body.signature });
  });

  // ----- LULO WITHDRAW (Lulo -> vault) -----
  app.post("/v1/lulo/withdrawals/prepare", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string().min(1), usd: z.number().positive() }).parse(req.body);
    if (await enforceRecoveryLock(req.user.sub, reply)) return;
    if (!luloEnabled) return reply.code(400).send({ error: "lulo_not_configured" });
    if (!usdcMint) return reply.code(400).send({ error: "usdc_mint_missing" });
    if (rejectRestrictedAdminPot(req, body.potId, reply, "withdraw")) return;

    const pot = await prisma.pot.findFirst({ where: { id: body.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const owner = new PublicKey(req.user.walletAddress);
    const { pda: vaultPda, potHash } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);
    const meta = resolveStrategyMeta((pot.strategyId as "low" | "med" | "high") || "low");
    const vaultInfo = await connection.getAccountInfo(vaultPda, "confirmed");
    if (!vaultInfo) return reply.code(400).send({ error: "vault_not_initialized" });
    if (vaultInfo.data && vaultInfo.data.length < VAULT_SPACE) {
      return reply.code(400).send({ error: "vault_upgrade_required" });
    }

    const isProtected = meta.luloMode === "PROTECTED";
    const luloEndpoint = isProtected
      ? "/v1/generate.instructions.withdrawProtected"
      : "/v1/generate.instructions.initiateRegularWithdraw";
    const luloRes = await fetchLulo(luloEndpoint, {
      owner: vaultPda.toBase58(),
      feePayer: owner.toBase58(),
      mintAddress: usdcMint.toBase58(),
      amount: body.usd,
    });

    const instructions: TransactionInstruction[] = [];
    const ixGroup = luloRes?.instructions || luloRes || {};
    const pendingWithdrawalId =
      luloRes?.pendingWithdrawalId ??
      ixGroup?.pendingWithdrawalId ??
      luloRes?.pendingWithdrawal?.id ??
      null;

    const pushNativeIx = (ix: any) => {
      if (!ix) return;
      const keys = toLuloKeys(ix.keys || [], vaultPda);
      instructions.push(
        new TransactionInstruction({
          programId: new PublicKey(ix.programId),
          keys,
          data: decodeLuloIxData(ix.data),
        })
      );
    };

    (ixGroup.computeBudgetInstructions || []).forEach(pushNativeIx);
    (ixGroup.setupInstructions || []).forEach(pushNativeIx);

    const makeVaultLuloIx = (ix: any) => {
      if (!ix) return;
      const luloKeys = toLuloKeys(ix.keys || [], vaultPda);
      const data = encodeLuloExecuteData(potHash, decodeLuloIxData(ix.data));
      instructions.push(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: luloProgramId!, isSigner: false, isWritable: false },
            ...luloKeys,
          ],
          data,
        })
      );
    };

    const primaryIx = pickLuloInstruction(
      ixGroup,
      isProtected
        ? [
            "protectedWithdrawInstruction",
            "withdrawProtectedInstruction",
            "protectedInstruction",
            "instruction",
          ]
        : [
            "initiateRegularWithdrawInstruction",
            "regularWithdrawInstruction",
            "withdrawRegularInstruction",
            "instruction",
          ]
    );
    if (!primaryIx) return reply.code(400).send({ error: "lulo_withdraw_ix_missing" });

    makeVaultLuloIx(primaryIx);

    const latest = await connection.getLatestBlockhash("finalized");
    const lookupAddresses: string[] = ixGroup.addressLookupTableAddresses || [];
    if (lookupAddresses.length) {
      const lookups = await Promise.all(
        lookupAddresses.map((addr: string) =>
          connection.getAddressLookupTable(new PublicKey(addr))
        )
      );
      const tables: AddressLookupTableAccount[] = lookups
        .map((l) => l.value)
        .filter((v): v is AddressLookupTableAccount => !!v);
      const msg = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: latest.blockhash,
        instructions,
      }).compileToV0Message(tables);
      const vtx = new VersionedTransaction(msg);
      const txBase64 = Buffer.from(vtx.serialize()).toString("base64");
      const op = await prisma.luloOp.create({
        data: {
          potId: pot.id,
          userId: req.user.sub,
          type: "UNWIND",
          amountLamports: String(Math.round(body.usd * 1_000_000)),
          status: isProtected ? "TX_READY" : "INITIATE_READY",
        },
      });
      return reply.send({
        txBase64,
        txVersion: "v0",
        mode: meta.luloMode,
        luloOpId: op.id,
        step: isProtected ? "withdraw" : "initiate",
        pendingWithdrawalId,
      });
    }

    const tx = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash });
    instructions.forEach((ix) => tx.add(ix));
    const txBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
    const op = await prisma.luloOp.create({
      data: {
        potId: pot.id,
        userId: req.user.sub,
        type: "UNWIND",
        amountLamports: String(Math.round(body.usd * 1_000_000)),
        status: isProtected ? "TX_READY" : "INITIATE_READY",
      },
    });
    return reply.send({
      txBase64,
      txVersion: "legacy",
      mode: meta.luloMode,
      luloOpId: op.id,
      step: isProtected ? "withdraw" : "initiate",
      pendingWithdrawalId,
    });
  });

  app.post("/v1/lulo/withdrawals/confirm", { preHandler: authGuard }, async (req: any, reply) => {
    const body = z
      .object({
        luloOpId: z.string().min(1),
        signature: z.string().min(20),
        pendingWithdrawalId: z.number().int().optional(),
      })
      .parse(req.body);

    const op = await prisma.luloOp.findFirst({ where: { id: body.luloOpId, userId: req.user.sub } });
    if (!op) return reply.code(404).send({ error: "lulo_op_not_found" });
    if (rejectRestrictedAdminPot(req, op.potId, reply, "withdraw")) return;
    if (op.status === "CONFIRMED") {
      if (op.txSig && op.txSig !== body.signature) {
        return reply.code(400).send({ error: "signature_mismatch" });
      }
      return reply.send({ ok: true, status: op.status, signature: op.txSig || body.signature });
    }

    const pot = await prisma.pot.findFirst({ where: { id: op.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });

    const owner = new PublicKey(req.user.walletAddress);
    const { pda } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);

    const tx = await connection.getTransaction(body.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return reply.code(400).send({ error: "tx_not_found" });
    if (tx.meta?.err) return reply.code(400).send({ error: "tx_failed" });

    const msg = tx.transaction.message;
    const { matches } = matchEscrowInstruction({
      msg,
      expectedDiscriminator: anchorDiscriminator("lulo_execute"),
      expectedPda: pda,
    });
    if (matches.length === 0) return reply.code(400).send({ error: "escrow_ix_missing" });

    const nextStatus = body.pendingWithdrawalId
      ? `INITIATED:${body.pendingWithdrawalId}`
      : "CONFIRMED";

    await prisma.luloOp.update({
      where: { id: op.id },
      data: { status: nextStatus, txSig: body.signature },
    });

    return reply.send({
      ok: true,
      status: nextStatus,
      signature: body.signature,
      nextStep: body.pendingWithdrawalId ? "complete" : null,
      pendingWithdrawalId: body.pendingWithdrawalId ?? null,
    });
  });

  app.post(
    "/v1/lulo/withdrawals/complete/prepare",
    { preHandler: authGuard },
    async (req: any, reply) => {
      const body = z
        .object({ luloOpId: z.string().min(1), pendingWithdrawalId: z.number().int().optional() })
        .parse(req.body);
      if (!luloEnabled) return reply.code(400).send({ error: "lulo_not_configured" });
      if (!usdcMint) return reply.code(400).send({ error: "usdc_mint_missing" });

      const op = await prisma.luloOp.findFirst({ where: { id: body.luloOpId, userId: req.user.sub } });
      if (!op) return reply.code(404).send({ error: "lulo_op_not_found" });
      if (rejectRestrictedAdminPot(req, op.potId, reply, "withdraw")) return;

      const pot = await prisma.pot.findFirst({ where: { id: op.potId, userId: req.user.sub } });
      if (!pot) return reply.code(404).send({ error: "pot_not_found" });

      const owner = new PublicKey(req.user.walletAddress);
      const { pda: vaultPda, potHash } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);

      const pendingId =
        body.pendingWithdrawalId ||
        (op.status.startsWith("INITIATED:") || op.status.startsWith("COMPLETE_READY:")
          ? Number(op.status.split(":")[1])
          : null);
      if (!pendingId || !Number.isFinite(pendingId)) {
        return reply.code(400).send({ error: "pending_withdrawal_id_missing" });
      }

      const luloRes = await fetchLulo("/v1/generate.instructions.completeRegularWithdrawal", {
        owner: vaultPda.toBase58(),
        feePayer: owner.toBase58(),
        pendingWithdrawalId: pendingId,
      });

      const instructions: TransactionInstruction[] = [];
      const ixGroup = luloRes?.instructions || luloRes || {};

      const pushNativeIx = (ix: any) => {
        if (!ix) return;
        const keys = toLuloKeys(ix.keys || [], vaultPda);
        instructions.push(
          new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            keys,
            data: decodeLuloIxData(ix.data),
          })
        );
      };

      (ixGroup.computeBudgetInstructions || []).forEach(pushNativeIx);
      (ixGroup.setupInstructions || []).forEach(pushNativeIx);

      const completeIx = pickLuloInstruction(ixGroup, [
        "completeRegularWithdrawalInstruction",
        "completeRegularWithdrawInstruction",
        "instruction",
      ]);
      if (!completeIx) return reply.code(400).send({ error: "lulo_withdraw_ix_missing" });

      const luloKeys = toLuloKeys(completeIx.keys || [], vaultPda);
      const data = encodeLuloExecuteData(potHash, decodeLuloIxData(completeIx.data));
      instructions.push(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: owner, isSigner: true, isWritable: false },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: luloProgramId!, isSigner: false, isWritable: false },
            ...luloKeys,
          ],
          data,
        })
      );

      const latest = await connection.getLatestBlockhash("finalized");
      const lookupAddresses: string[] = ixGroup.addressLookupTableAddresses || [];
      if (lookupAddresses.length) {
        const lookups = await Promise.all(
          lookupAddresses.map((addr: string) =>
            connection.getAddressLookupTable(new PublicKey(addr))
          )
        );
        const tables: AddressLookupTableAccount[] = lookups
          .map((l) => l.value)
          .filter((v): v is AddressLookupTableAccount => !!v);
        const msg = new TransactionMessage({
          payerKey: owner,
          recentBlockhash: latest.blockhash,
          instructions,
        }).compileToV0Message(tables);
        const vtx = new VersionedTransaction(msg);
        const txBase64 = Buffer.from(vtx.serialize()).toString("base64");
        await prisma.luloOp.update({
          where: { id: op.id },
          data: { status: `COMPLETE_READY:${pendingId}` },
        });
        return reply.send({
          txBase64,
          txVersion: "v0",
          luloOpId: op.id,
          step: "complete",
          pendingWithdrawalId: pendingId,
        });
      }

      const tx = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash });
      instructions.forEach((ix) => tx.add(ix));
      const txBase64 = tx.serialize({ requireAllSignatures: false }).toString("base64");
      await prisma.luloOp.update({
        where: { id: op.id },
        data: { status: `COMPLETE_READY:${pendingId}` },
      });
      return reply.send({
        txBase64,
        txVersion: "legacy",
        luloOpId: op.id,
        step: "complete",
        pendingWithdrawalId: pendingId,
      });
    }
  );

  app.post(
    "/v1/lulo/withdrawals/complete/confirm",
    { preHandler: authGuard },
    async (req: any, reply) => {
      const body = z
        .object({ luloOpId: z.string().min(1), signature: z.string().min(20) })
        .parse(req.body);

      const op = await prisma.luloOp.findFirst({ where: { id: body.luloOpId, userId: req.user.sub } });
      if (!op) return reply.code(404).send({ error: "lulo_op_not_found" });
      if (rejectRestrictedAdminPot(req, op.potId, reply, "withdraw")) return;
      if (op.status === "CONFIRMED") {
        if (op.txSig && op.txSig !== body.signature) {
          return reply.code(400).send({ error: "signature_mismatch" });
        }
        return reply.send({ ok: true, status: op.status, signature: op.txSig || body.signature });
      }

      const pot = await prisma.pot.findFirst({ where: { id: op.potId, userId: req.user.sub } });
      if (!pot) return reply.code(404).send({ error: "pot_not_found" });

      const owner = new PublicKey(req.user.walletAddress);
      const { pda } = deriveVaultPdaFromPotId(owner, pot.id, escrowProgramId);

      const tx = await connection.getTransaction(body.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (!tx) return reply.code(400).send({ error: "tx_not_found" });
      if (tx.meta?.err) return reply.code(400).send({ error: "tx_failed" });

      const msg = tx.transaction.message;
      const { matches } = matchEscrowInstruction({
        msg,
        expectedDiscriminator: anchorDiscriminator("lulo_execute"),
        expectedPda: pda,
      });
      if (matches.length === 0) return reply.code(400).send({ error: "escrow_ix_missing" });

      await prisma.luloOp.update({
        where: { id: op.id },
        data: { status: "CONFIRMED", txSig: body.signature },
      });

      return reply.send({ ok: true, status: "CONFIRMED", signature: body.signature });
    }
  );

  // ----- SOL DEPOSIT + WITHDRAW (Escrow PDA, devnet) -----
  // This replaces the old direct vault transfer.
  // Model C compliant: backend never holds keys; user signs all txs in Phantom.
  //
  // Env:
  // - SOLANA_RPC
  // - KOBA_ESCROW_PROGRAM_ID (Anchor program deployed to devnet)
  //
  // Flow:
  // - prepare: creates a Deposit intent (USD) and returns a ready-to-sign tx
  // - confirm: verifies tx includes our program + correct vault PDA + amount
  // - withdraw: creates a Withdrawal intent and returns tx; confirm marks complete

  function u64le(n: number | bigint) {
    const b = Buffer.alloc(8);
    const x = BigInt(n);
    b.writeBigUInt64LE(x, 0);
    return b;
  }

  function u32le(n: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return b;
  }

  function getAta(owner: PublicKey, mint: PublicKey) {
    const [ata] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return ata;
  }

  function decodeLuloIxData(data: any): Buffer {
    if (!data) return Buffer.alloc(0);
    if (Array.isArray(data)) return Buffer.from(data);
    if (typeof data === "string") {
      try {
        return Buffer.from(data, "base64");
      } catch {
        return Buffer.from(data);
      }
    }
    return Buffer.alloc(0);
  }

  function isLuloIxShape(ix: any) {
    return ix && typeof ix === "object" && ix.programId && ix.data && ix.keys;
  }

  function pickLuloInstruction(ixGroup: any, names: string[]) {
    for (const name of names) {
      const ix = ixGroup?.[name];
      if (ix) return ix;
    }
    if (isLuloIxShape(ixGroup)) return ixGroup;
    return null;
  }

  function toLuloKeys(keys: any[], vaultPda: PublicKey) {
    return (keys || []).map((k: any) => {
      const pubkeyStr = k.pubkey || k.publicKey || k.key || k;
      const pubkey = new PublicKey(pubkeyStr);
      const isSigner = !!(k.isSigner ?? k.signer ?? false);
      const isWritable = !!(k.isWritable ?? k.writable ?? false);
      // Vault PDA must NOT be marked signer in the outer tx.
      return {
        pubkey,
        isSigner: pubkey.equals(vaultPda) ? false : isSigner,
        isWritable,
      };
    });
  }

  function encodeLuloExecuteData(potHash: Uint8Array, ixData: Buffer) {
    return Buffer.concat([
      Buffer.from(anchorDiscriminator("lulo_execute")),
      Buffer.from(potHash),
      u32le(ixData.length),
      ixData,
    ]);
  }

  function decodeJupiterIxData(data: any): Buffer {
    return decodeLuloIxData(data);
  }

  function toJupiterKeys(accounts: any[]) {
    return (accounts || []).map((k: any) => {
      const pubkeyStr = k.pubkey || k.publicKey || k.key || k;
      const pubkey = new PublicKey(pubkeyStr);
      const isSigner = !!(k.isSigner ?? k.signer ?? false);
      const isWritable = !!(k.isWritable ?? k.writable ?? false);
      return { pubkey, isSigner, isWritable };
    });
  }

  function jupiterIxToInstruction(ix: any) {
    if (!ix) return null;
    const keys = toJupiterKeys(ix.accounts || ix.keys || []);
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys,
      data: decodeJupiterIxData(ix.data),
    });
  }

  function createAtaIx(params: {
    payer: PublicKey;
    ata: PublicKey;
    owner: PublicKey;
    mint: PublicKey;
  }) {
    return new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: params.payer, isSigner: true, isWritable: true },
        { pubkey: params.ata, isSigner: false, isWritable: true },
        { pubkey: params.owner, isSigner: false, isWritable: false },
        { pubkey: params.mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(0),
    });
  }

  async function fetchLulo(path: string, body: any) {
    if (!luloApiKey) throw new Error("lulo_api_key_missing");
    const res = await fetch(`${luloApiBase}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": luloApiKey,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async function fetchJupiterQuote(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: number;
    slippageBps?: number;
  }) {
    if (!jupiterApiBase) throw new Error("jupiter_api_base_missing");
    if (jupiterApiBase.includes("api.jup.ag") && !jupiterApiKey) {
      throw new Error("jupiter_api_key_missing");
    }
    const url = new URL(`${jupiterApiBase}/swap/v1/quote`);
    url.searchParams.set("inputMint", params.inputMint.toBase58());
    url.searchParams.set("outputMint", params.outputMint.toBase58());
    url.searchParams.set("amount", String(params.amount));
    url.searchParams.set("swapMode", "ExactIn");
    url.searchParams.set("slippageBps", String(params.slippageBps ?? 50));

    const res = await fetch(url.toString(), {
      headers: jupiterApiKey ? { "x-api-key": jupiterApiKey } : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async function fetchJupiterSwapInstructions(body: any) {
    if (!jupiterApiBase) throw new Error("jupiter_api_base_missing");
    if (jupiterApiBase.includes("api.jup.ag") && !jupiterApiKey) {
      throw new Error("jupiter_api_key_missing");
    }
    const res = await fetch(`${jupiterApiBase}/swap/v1/swap-instructions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(jupiterApiKey ? { "x-api-key": jupiterApiKey } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  }

  async function buildEscrowTx(params: {
    owner: PublicKey;
    potId: string;
    lamports: number;
    type: "deposit" | "withdraw";
    usdcMint: PublicKey | null;
    feeLamports?: number;
    adminVault?: PublicKey | null;
  }) {
    const { pda, potHash: ph } = deriveVaultPdaFromPotId(
      params.owner,
      params.potId,
      escrowProgramId
    );
    const latest = await connection.getLatestBlockhash('finalized');

    const tx = new Transaction({
      feePayer: params.owner,
      recentBlockhash: latest.blockhash,
    });

    // If vault account doesn't exist, include init instruction first.
    const acct = await connection.getAccountInfo(pda, "confirmed");
    if (acct && acct.data && acct.data.length < VAULT_SPACE) {
      throw new Error("vault_upgrade_required");
    }
    if (!acct) {
      if (params.type === "withdraw") {
        throw new Error("vault_not_initialized");
      }
      if (!params.usdcMint) {
        throw new Error("usdc_mint_missing");
      }
      const vaultUsdc = getAta(pda, params.usdcMint);
      const data = Buffer.concat([anchorDiscriminator("init_pot_vault"), ph]);
      tx.add(
        new TransactionInstruction({
          programId: escrowProgramId,
          keys: [
            { pubkey: params.owner, isSigner: true, isWritable: true },
            { pubkey: pda, isSigner: false, isWritable: true },
            { pubkey: params.usdcMint, isSigner: false, isWritable: false },
            { pubkey: vaultUsdc, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data,
        })
      );
    }

    let ixName = params.type === "deposit" ? "deposit" : "withdraw";
    let data = Buffer.concat([anchorDiscriminator(ixName), ph, u64le(params.lamports)]);
    let keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
    ];

    if (params.type === "withdraw" && params.feeLamports && params.feeLamports > 0) {
      if (!params.adminVault) throw new Error("admin_vault_missing");
      if (params.adminVault.equals(pda)) throw new Error("admin_vault_conflict");
      ixName = "withdraw_with_fee";
      data = Buffer.concat([
        anchorDiscriminator(ixName),
        ph,
        u64le(params.lamports),
        u64le(params.feeLamports),
      ]);
      keys.push({ pubkey: params.adminVault, isSigner: false, isWritable: true });
    }

    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });

    tx.add(
      new TransactionInstruction({
        programId: escrowProgramId,
        keys,
        data,
      })
    );

    return { tx, vaultPda: pda.toBase58() };
  }

  function getAdminVaultPda() {
    if (!adminWallet || !adminPotId) {
      throw new Error("admin_vault_missing");
    }
    return deriveVaultPdaFromPotId(adminWallet, adminPotId, escrowProgramId).pda;
  }

  function getMessageAccountKeys(msg: any): PublicKey[] {
    if (Array.isArray((msg as any).staticAccountKeys)) return (msg as any).staticAccountKeys;
    if (Array.isArray((msg as any).accountKeys)) return (msg as any).accountKeys;
    return [];
  }

  function getMessageInstructions(msg: any): any[] {
    if (Array.isArray((msg as any).compiledInstructions)) return (msg as any).compiledInstructions;
    if (Array.isArray((msg as any).instructions)) return (msg as any).instructions;
    return [];
  }

  async function enforceRecoveryLock(userId: string, reply: any) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.recoveryLockedUntil) return false;
    const now = new Date();
    if (now < user.recoveryLockedUntil) {
      reply.code(403).send({
        error: "recovery_lock",
        lockedUntil: user.recoveryLockedUntil.toISOString(),
      });
      return true;
    }
    return false;
  }

  function matchEscrowInstruction(params: {
    msg: any;
    expectedDiscriminator: Uint8Array;
    expectedPda: PublicKey;
  }) {
    const accountKeys = getMessageAccountKeys(params.msg);
    const instructions = getMessageInstructions(params.msg);

    const escrowIxs = instructions
      .map((ix: any, idx: number) => ({ ix, idx }))
      .filter(({ ix }) => {
        const programKey = accountKeys[ix.programIdIndex];
        if (!programKey) return false;
        if (typeof (programKey as any).equals === "function") {
          return (programKey as any).equals(escrowProgramId);
        }
        return String(programKey) === escrowProgramId.toBase58();
      });

    const matches: { data: Uint8Array; ix: any }[] = [];
    for (const { ix } of escrowIxs) {
      const raw = decodeInstructionData(ix.data);
      if (raw.length < 8) continue;
      const discr = raw.subarray(0, 8);
      if (!Buffer.from(discr).equals(Buffer.from(params.expectedDiscriminator))) continue;

      const accountIndexes = Array.isArray(ix.accountKeyIndexes)
        ? ix.accountKeyIndexes
        : Array.isArray(ix.accounts)
        ? ix.accounts
        : [];
      const ixAccounts = accountIndexes
        .map((i: number) => accountKeys[i])
        .filter(Boolean)
        .map((k: any) => (typeof k.toBase58 === "function" ? k.toBase58() : String(k)));

      if (!ixAccounts.includes(params.expectedPda.toBase58())) continue;

      matches.push({ data: raw, ix });
    }

    return { matches };
  }

  app.post('/v1/deposits/sol/prepare', { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string().min(1), usd: z.number().positive() }).parse(req.body);
    if (body.usd < MIN_DEPOSIT_USD) {
      return reply.code(400).send({ error: "min_deposit", minUsd: MIN_DEPOSIT_USD });
    }

    const pot = await prisma.pot.findFirst({ where: { id: body.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: 'pot_not_found' });

    const solPriceUsd = await getSolUsdPriceCached();
    const rawSol = body.usd / solPriceUsd;
    const lamports = Math.ceil(rawSol * LAMPORTS_PER_SOL);
    const sol = lamports / LAMPORTS_PER_SOL;
    if (!Number.isFinite(lamports) || lamports <= 0) return reply.code(400).send({ error: 'invalid_amount' });

    const dep = await prisma.deposit.create({
      data: {
        userId: req.user.sub,
        potId: body.potId,
        netUsdc: body.usd,
        amountLamports: String(lamports),
        status: `SOL_PENDING:${lamports}`,
      },
    });

    const owner = new PublicKey(req.user.walletAddress);
    let built;
    try {
      built = await buildEscrowTx({
        owner,
        potId: body.potId,
        lamports,
        type: "deposit",
        usdcMint,
      });
    } catch (err: any) {
      if (err?.message === "usdc_mint_missing") {
        return reply.code(400).send({ error: "usdc_mint_missing" });
      }
      if (err?.message === "vault_upgrade_required") {
        return reply.code(400).send({ error: "vault_upgrade_required" });
      }
      throw err;
    }
    const txBase64 = built.tx.serialize({ requireAllSignatures: false }).toString('base64');

    return reply.send({
      depositId: dep.id,
      usd: body.usd,
      solPriceUsd,
      sol,
      lamports,
      vaultPda: built.vaultPda,
      txBase64,
      note: 'Sign this tx in Phantom to deposit SOL into your per-pot escrow vault (devnet).',
    });
  });

  app.post('/v1/deposits/sol/confirm', { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ depositId: z.string().min(1), signature: z.string().min(20) }).parse(req.body);

    const dep = await prisma.deposit.findFirst({ where: { id: body.depositId, userId: req.user.sub } });
    if (!dep) return reply.code(404).send({ error: 'deposit_not_found' });

    const status = String(dep.status);
    if (status === 'SOL_CONFIRMED') {
      if (dep.txSig && dep.txSig !== body.signature) {
        return reply.code(400).send({ error: 'signature_mismatch' });
      }
      return reply.send({
        ok: true,
        status: 'SOL_CONFIRMED',
        signature: dep.txSig || body.signature,
        usd: dep.netUsdc,
      });
    }
    if (!status.startsWith('SOL_PENDING:')) {
      return reply.code(400).send({ error: 'invalid_state', status });
    }

    if (dep.txSig && dep.txSig !== body.signature) {
      return reply.code(400).send({ error: 'signature_mismatch' });
    }

    const expectedLamports = Number(status.split(':')[1] || 0);
    if (!Number.isFinite(expectedLamports) || expectedLamports <= 0) return reply.code(400).send({ error: 'deposit_missing_quote' });

    const owner = new PublicKey(req.user.walletAddress);
    const { pda, potHash: expectedPotHash } = deriveVaultPdaFromPotId(
      owner,
      dep.potId,
      escrowProgramId
    );

    const tx = await connection.getTransaction(body.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx) return reply.code(400).send({ error: 'tx_not_found' });
    if (tx.meta?.err) return reply.code(400).send({ error: 'tx_failed' });

    const msg = tx.transaction.message;
    const { matches } = matchEscrowInstruction({
      msg,
      expectedDiscriminator: anchorDiscriminator('deposit'),
      expectedPda: pda,
    });
    if (matches.length === 0) return reply.code(400).send({ error: 'escrow_ix_missing' });
    if (matches.length > 1) return reply.code(400).send({ error: 'escrow_ix_multiple' });

    let parsed: { potHash: Uint8Array; lamports: bigint; feeLamports: bigint | null };
    try {
      parsed = parseEscrowInstructionData(matches[0].data);
    } catch {
      return reply.code(400).send({ error: 'escrow_ix_invalid' });
    }

    if (!Buffer.from(parsed.potHash).equals(Buffer.from(expectedPotHash))) {
      return reply.code(400).send({ error: 'escrow_pot_mismatch' });
    }

    const expectedLamportsBig = BigInt(expectedLamports);
    if (parsed.lamports !== expectedLamportsBig) {
      return reply
        .code(400)
        .send({ error: 'escrow_amount_mismatch', expectedLamports, actualLamports: parsed.lamports.toString() });
    }

    await prisma.deposit.update({
      where: { id: dep.id },
      data: { status: 'SOL_CONFIRMED', txSig: body.signature },
    });

    if (luloEnabled) {
      const existingOp = await prisma.luloOp.findFirst({
        where: { depositId: dep.id, type: "ALLOCATE" },
      });
      if (!existingOp) {
        await prisma.luloOp.create({
          data: {
            potId: dep.potId,
            userId: req.user.sub,
            depositId: dep.id,
            type: "ALLOCATE",
            amountLamports: String(expectedLamports),
            status: "PENDING",
          },
        });
      }
    }

    return reply.send({ ok: true, status: 'SOL_CONFIRMED', signature: body.signature, usd: dep.netUsdc });
  });

  app.post('/v1/withdrawals/sol/prepare', { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ potId: z.string().min(1), usd: z.number().positive() }).parse(req.body);
    if (await enforceRecoveryLock(req.user.sub, reply)) return;
    if (rejectRestrictedAdminPot(req, body.potId, reply, "withdraw")) return;

    const pot = await prisma.pot.findFirst({ where: { id: body.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: 'pot_not_found' });

    // Basic balance check: only SOL-confirmed deposits minus SOL withdrawals.
    const deposits = await prisma.deposit.findMany({
      where: {
        potId: body.potId,
        userId: req.user.sub,
        status: { in: ['SOL_CONFIRMED', 'WITHDRAW_CONFIRMED'] },
      },
    });
    const balance = deposits.reduce((a, d) => a + d.netUsdc, 0);
    if (body.usd > balance) return reply.code(400).send({ error: 'insufficient_balance' });

    const solPriceUsd = await getSolUsdPriceCached();
    const rawSol = body.usd / solPriceUsd;
    const lamports = Math.ceil(rawSol * LAMPORTS_PER_SOL);
    const sol = lamports / LAMPORTS_PER_SOL;

    const owner = new PublicKey(req.user.walletAddress);
    const locked = !!pot.isLocked;
    const feeLamports = locked ? calcFeeLamports(lamports) : 0;
    const feeUsd = locked ? (body.usd * LOCKED_WITHDRAW_FEE_BPS) / 10_000 : 0;
    let adminVault: PublicKey | null = null;

    // Extra safety: ensure the per-pot PDA vault exists and actually has enough
    // lamports on-chain. If not, Phantom often bubbles up an "Unexpected error"
    // with little context.
    const { pda } = deriveVaultPdaFromPotId(owner, body.potId, escrowProgramId);
    let info;
    try {
      info = await connection.getAccountInfo(pda, { commitment: 'confirmed' });
    } catch (_) {
      return reply.code(503).send({ error: 'rpc_unavailable' });
    }
    if (!info) {
      return reply.code(400).send({ error: 'vault_not_initialized' });
    }
    if (info.data && info.data.length < VAULT_SPACE) {
      return reply.code(400).send({ error: "vault_upgrade_required" });
    }
    const rent = await getVaultRentCached(connection);
    const available = Math.max(0, info.lamports - rent);
    if (lamports > available) {
      return reply
        .code(400)
        .send({ error: 'insufficient_vault_balance', availableLamports: available, requiredLamports: lamports });
    }

    if (locked) {
      try {
        adminVault = getAdminVaultPda();
      } catch (err: any) {
        return reply.code(400).send({ error: err?.message || "admin_vault_missing" });
      }
      if (adminVault.equals(pda)) {
        return reply.code(400).send({
          error: "admin_vault_conflict",
          message:
            "Admin vault resolves to the same PDA as the withdrawing pot. Set KOBA_ADMIN_POT_ID (or KOBA_ADMIN_WALLET) to a different admin pot.",
        });
      }
      const adminInfo = await connection.getAccountInfo(adminVault, { commitment: "confirmed" });
      if (!adminInfo) {
        return reply.code(400).send({ error: "admin_vault_not_initialized" });
      }
      if (adminInfo.data && adminInfo.data.length < VAULT_SPACE) {
        return reply.code(400).send({ error: "admin_vault_upgrade_required" });
      }
    }

    let built;
    try {
      built = await buildEscrowTx({
        owner,
        potId: body.potId,
        lamports,
        type: "withdraw",
        usdcMint,
        feeLamports: locked ? feeLamports : undefined,
        adminVault,
      });
    } catch (err: any) {
      if (err?.message === 'vault_not_initialized') {
        return reply.code(400).send({ error: 'vault_not_initialized' });
      }
      if (err?.message === "vault_upgrade_required") {
        return reply.code(400).send({ error: "vault_upgrade_required" });
      }
      if (err?.message === "usdc_mint_missing") {
        return reply.code(400).send({ error: "usdc_mint_missing" });
      }
      if (err?.message === "admin_vault_conflict") {
        return reply.code(400).send({
          error: "admin_vault_conflict",
          message:
            "Admin vault resolves to the same PDA as the withdrawing pot. Set KOBA_ADMIN_POT_ID (or KOBA_ADMIN_WALLET) to a different admin pot.",
        });
      }
      throw err;
    }
    const txBase64 = built.tx.serialize({ requireAllSignatures: false }).toString('base64');

    // PoC ledger: store a negative deposit row to represent withdrawal.
    const wd = await prisma.deposit.create({
      data: {
        userId: req.user.sub,
        potId: body.potId,
        netUsdc: -Math.abs(body.usd),
        amountLamports: String(lamports),
        status: `WITHDRAW_PENDING:${lamports}`,
      },
    });

    return reply.send({
      withdrawalId: wd.id,
      usd: body.usd,
      feeUsd: locked ? feeUsd : 0,
      netUsd: locked ? Math.max(0, body.usd - feeUsd) : body.usd,
      solPriceUsd,
      sol,
      lamports,
      feeLamports: locked ? feeLamports : 0,
      vaultPda: built.vaultPda,
      txBase64,
      note: locked
        ? "Pot is locked. A 15% fee will be sent to the admin vault."
        : "Sign this tx in Phantom to withdraw SOL from your per-pot escrow vault back to your wallet.",
    });
  });

  app.post('/v1/withdrawals/sol/confirm', { preHandler: authGuard }, async (req: any, reply) => {
    const body = z.object({ withdrawalId: z.string().min(1), signature: z.string().min(20) }).parse(req.body);

    const wd = await prisma.deposit.findFirst({ where: { id: body.withdrawalId, userId: req.user.sub } });
    if (!wd) return reply.code(404).send({ error: 'withdrawal_not_found' });
    if (rejectRestrictedAdminPot(req, wd.potId, reply, "withdraw")) return;

    const status = String(wd.status);
    if (status === 'WITHDRAW_CONFIRMED') {
      if (wd.txSig && wd.txSig !== body.signature) {
        return reply.code(400).send({ error: 'signature_mismatch' });
      }
      return reply.send({
        ok: true,
        status: 'WITHDRAW_CONFIRMED',
        signature: wd.txSig || body.signature,
        usd: wd.netUsdc,
      });
    }
    if (!status.startsWith('WITHDRAW_PENDING:')) {
      return reply.code(400).send({ error: 'invalid_state', status });
    }

    if (wd.txSig && wd.txSig !== body.signature) {
      return reply.code(400).send({ error: 'signature_mismatch' });
    }

    const expectedLamports = Number(status.split(':')[1] || 0);
    if (!Number.isFinite(expectedLamports) || expectedLamports <= 0) return reply.code(400).send({ error: 'withdrawal_missing_quote' });

    const pot = await prisma.pot.findFirst({ where: { id: wd.potId, userId: req.user.sub } });
    if (!pot) return reply.code(404).send({ error: "pot_not_found" });
    const locked = !!pot.isLocked;

    const owner = new PublicKey(req.user.walletAddress);
    const { pda, potHash: expectedPotHash } = deriveVaultPdaFromPotId(
      owner,
      wd.potId,
      escrowProgramId
    );

    const tx = await connection.getTransaction(body.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx) return reply.code(400).send({ error: 'tx_not_found' });
    if (tx.meta?.err) return reply.code(400).send({ error: 'tx_failed' });

    const msg = tx.transaction.message;
    const { matches } = matchEscrowInstruction({
      msg,
      expectedDiscriminator: anchorDiscriminator(locked ? "withdraw_with_fee" : "withdraw"),
      expectedPda: pda,
    });
    if (matches.length === 0) return reply.code(400).send({ error: 'escrow_ix_missing' });
    if (matches.length > 1) return reply.code(400).send({ error: 'escrow_ix_multiple' });

    let parsed: { potHash: Uint8Array; lamports: bigint; feeLamports: bigint | null };
    try {
      parsed = parseEscrowInstructionData(matches[0].data);
    } catch {
      return reply.code(400).send({ error: 'escrow_ix_invalid' });
    }

    if (!Buffer.from(parsed.potHash).equals(Buffer.from(expectedPotHash))) {
      return reply.code(400).send({ error: 'escrow_pot_mismatch' });
    }

    const expectedLamportsBig = BigInt(expectedLamports);
    if (parsed.lamports !== expectedLamportsBig) {
      return reply
        .code(400)
        .send({ error: 'escrow_amount_mismatch', expectedLamports, actualLamports: parsed.lamports.toString() });
    }

    if (locked) {
      const expectedFeeLamports = BigInt(calcFeeLamports(expectedLamports));
      if (parsed.feeLamports !== expectedFeeLamports) {
        return reply.code(400).send({
          error: "escrow_fee_mismatch",
          expectedFeeLamports: expectedFeeLamports.toString(),
          actualFeeLamports: parsed.feeLamports?.toString() ?? null,
        });
      }
    } else if (parsed.feeLamports && parsed.feeLamports > 0n) {
      return reply.code(400).send({ error: "escrow_unexpected_fee" });
    }

    await prisma.deposit.update({
      where: { id: wd.id },
      data: { status: 'WITHDRAW_CONFIRMED', txSig: body.signature },
    });

    if (locked && adminWallet && adminPotId) {
      const feeUsd = Math.abs(wd.netUsdc) * (LOCKED_WITHDRAW_FEE_BPS / 10_000);
      if (feeUsd > 0) {
        const adminWalletStr = adminWallet.toBase58();
        const adminUser = await prisma.user.upsert({
          where: { walletAddress: adminWalletStr },
          update: {},
          create: { walletAddress: adminWalletStr },
        });
        await prisma.pot.upsert({
          where: { id: adminPotId },
          update: {},
          create: {
            id: adminPotId,
            userId: adminUser.id,
            name: "Admin Vault",
            strategyId: "low",
          },
        });

        const existingFee = await prisma.deposit.findFirst({
          where: {
            potId: adminPotId,
            userId: adminUser.id,
            txSig: body.signature,
            status: "FEE_CONFIRMED",
          },
        });
        if (!existingFee) {
          await prisma.deposit.create({
            data: {
              userId: adminUser.id,
              potId: adminPotId,
              netUsdc: feeUsd,
              amountLamports: String(calcFeeLamports(expectedLamports)),
              status: "FEE_CONFIRMED",
              txSig: body.signature,
            },
          });
        }
      }
    }

    return reply.send({ ok: true, status: 'WITHDRAW_CONFIRMED', signature: body.signature, usd: wd.netUsdc });
  });



}

async function main() {
  await registerRoutes();

  const port = Number(process.env.PORT || 3001);
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`Backend running on http://localhost:${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
