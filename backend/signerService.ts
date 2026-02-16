import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

type RiskState = "NORMAL" | "CAUTION" | "RISK_OFF";

type AllocationBps = {
  usdc: number;
  btc: number;
  eth: number;
  sol: number;
};

type ShadowPolicy = {
  pod_id: string;
  target_allocations_bps: AllocationBps;
  usdc_in_lulo_bps: number;
  risk_state: RiskState;
  reason?: string;
  updated_at: string;
};

const shadowPolicyStore = new Map<string, ShadowPolicy>();

const bpsSchema = z.object({
  usdc: z.number().int().min(0).max(10_000),
  btc: z.number().int().min(0).max(10_000),
  eth: z.number().int().min(0).max(10_000),
  sol: z.number().int().min(0).max(10_000),
});

const pctSchema = z.object({
  usdc: z.number().min(0).max(100),
  btc: z.number().min(0).max(100),
  eth: z.number().min(0).max(100),
  sol: z.number().min(0).max(100),
});

const payloadSchema = z.object({
  pod_id: z.string().min(1),
  target_allocations_bps: bpsSchema.optional(),
  target_allocations_pct: pctSchema.optional(),
  usdc_in_lulo_bps: z.number().int().min(0).max(10_000),
  risk_state: z.enum(["NORMAL", "CAUTION", "RISK_OFF"]),
  reason: z.string().max(500).optional(),
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function anchorDiscriminator(ixName: string): Buffer {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

function podIdHash(podId: string): Buffer {
  return crypto.createHash("sha256").update(podId).digest();
}

function u16le(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function riskStateToCode(risk: RiskState): number {
  if (risk === "NORMAL") return 0;
  if (risk === "CAUTION") return 1;
  return 2;
}

function toBpsExact10000FromPct(pct: { usdc: number; btc: number; eth: number; sol: number }): AllocationBps {
  const raw = {
    usdc: pct.usdc * 100,
    btc: pct.btc * 100,
    eth: pct.eth * 100,
    sol: pct.sol * 100,
  };
  const out = {
    usdc: Math.floor(raw.usdc),
    btc: Math.floor(raw.btc),
    eth: Math.floor(raw.eth),
    sol: Math.floor(raw.sol),
  };
  let remainder = 10_000 - (out.usdc + out.btc + out.eth + out.sol);
  const ranked = (
    [
      { key: "usdc", frac: raw.usdc - out.usdc },
      { key: "btc", frac: raw.btc - out.btc },
      { key: "eth", frac: raw.eth - out.eth },
      { key: "sol", frac: raw.sol - out.sol },
    ] as Array<{ key: keyof AllocationBps; frac: number }>
  ).sort((a, b) => b.frac - a.frac);

  let i = 0;
  while (remainder > 0) {
    const key = ranked[i % ranked.length].key;
    out[key] += 1;
    remainder -= 1;
    i += 1;
  }
  return out;
}

function decodeSigner(): Keypair {
  const b58 = process.env.SIGNER_SECRET_KEY_B58;
  if (b58) return Keypair.fromSecretKey(bs58.decode(b58));

  const json = process.env.SIGNER_SECRET_KEY_JSON;
  if (json) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));

  const path = process.env.SOLANA_KEYPAIR_PATH;
  if (path) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));

  throw new Error("Missing signer key env (SIGNER_SECRET_KEY_B58 or SIGNER_SECRET_KEY_JSON or SOLANA_KEYPAIR_PATH).");
}

function isMissingInstructionError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  return msg.includes("InstructionFallbackNotFound") || msg.includes("custom program error: 0x65");
}

function derivePodConfigPda(programId: PublicKey, podId: string): PublicKey {
  const seedPrefix = process.env.POD_CONFIG_SEED_PREFIX || "pod_policy";
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from(seedPrefix), podIdHash(podId)], programId);
  return pda;
}

async function submitUpdateTx(params: {
  connection: Connection;
  signer: Keypair;
  programId: PublicKey;
  podId: string;
  targetBps: AllocationBps;
  usdcInLuloBps: number;
  riskState: RiskState;
}) {
  const { connection, signer, programId, podId, targetBps, usdcInLuloBps, riskState } = params;
  const podConfig = derivePodConfigPda(programId, podId);
  const data = Buffer.concat([
    anchorDiscriminator("update_policy"),
    podIdHash(podId),
    Buffer.from([riskStateToCode(riskState)]),
    u16le(targetBps.usdc),
    u16le(targetBps.btc),
    u16le(targetBps.eth),
    u16le(targetBps.sol),
    u16le(usdcInLuloBps),
  ]);

  // Policy update only; does not move user funds.
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: podConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(ix);
  tx.sign(signer);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(`tx_failed:${JSON.stringify(confirmation.value.err)}`);
  }

  return { signature, podConfigPda: podConfig.toBase58() };
}

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const connection = new Connection(requireEnv("SOLANA_RPC"), "confirmed");
  const signer = decodeSigner();
  const programId = new PublicKey(requireEnv("KOBA_ESCROW_PROGRAM_ID"));
  const allowOffchainPolicyFallback = String(
    process.env.SIGNER_ALLOW_OFFCHAIN_POLICY || "false"
  ).toLowerCase() === "true";

  app.get("/health", async () => ({
    ok: true,
    signer: signer.publicKey.toBase58(),
    programId: programId.toBase58(),
    allowOffchainPolicyFallback,
  }));

  app.post("/update_policy", async (req, reply) => {
    const body = payloadSchema.parse(req.body);
    const creRunId = String((req.headers as any)["x-cre-run-id"] || "");
    if (creRunId) {
      req.log.info({ creRunId, pod_id: body.pod_id }, "signer_update_policy_received");
    }
    const targetBps = body.target_allocations_bps
      ? body.target_allocations_bps
      : body.target_allocations_pct
      ? toBpsExact10000FromPct(body.target_allocations_pct)
      : null;

    if (!targetBps) {
      return reply.code(400).send({
        error: "missing_target_allocations",
        message: "Provide target_allocations_bps or target_allocations_pct.",
      });
    }

    const sum = targetBps.usdc + targetBps.btc + targetBps.eth + targetBps.sol;
    if (sum !== 10_000) {
      return reply.code(400).send({ error: "invalid_target_sum", expected: 10_000, actual: sum });
    }
    if (body.usdc_in_lulo_bps > targetBps.usdc) {
      return reply.code(400).send({
        error: "invalid_lulo_allocation",
        message: "usdc_in_lulo_bps must be <= target USDC bps.",
      });
    }

    try {
      const tx = await submitUpdateTx({
        connection,
        signer,
        programId,
        podId: body.pod_id,
        targetBps,
        usdcInLuloBps: body.usdc_in_lulo_bps,
        riskState: body.risk_state,
      });

      return reply.send({
        ok: true,
        pod_id: body.pod_id,
        target_allocations_bps: targetBps,
        usdc_in_lulo_bps: body.usdc_in_lulo_bps,
        risk_state: body.risk_state,
        signature: tx.signature,
        confirmed: true,
        simulated: false,
        pod_config_pda: tx.podConfigPda,
      });
    } catch (err: any) {
      if (allowOffchainPolicyFallback && isMissingInstructionError(err)) {
        const snapshot: ShadowPolicy = {
          pod_id: body.pod_id,
          target_allocations_bps: targetBps,
          usdc_in_lulo_bps: body.usdc_in_lulo_bps,
          risk_state: body.risk_state,
          reason: body.reason,
          updated_at: new Date().toISOString(),
        };
        shadowPolicyStore.set(body.pod_id, snapshot);

        req.log.warn(
          { pod_id: body.pod_id, creRunId: creRunId || undefined },
          "onchain update_policy instruction missing; stored policy offchain fallback"
        );
        return reply.send({
          ok: true,
          pod_id: body.pod_id,
          target_allocations_bps: targetBps,
          usdc_in_lulo_bps: body.usdc_in_lulo_bps,
          risk_state: body.risk_state,
          signature: null,
          confirmed: false,
          simulated: true,
          warning: "update_policy_instruction_missing_onchain",
          stored_at: snapshot.updated_at,
        });
      }

      req.log.error({ err, creRunId: creRunId || undefined, pod_id: body.pod_id }, "update_policy_failed");
      return reply.code(500).send({
        error: "update_policy_failed",
        message: err?.message || String(err),
      });
    }
  });

  app.get("/policy/:podId", async (req: any, reply) => {
    const podId = String(req.params.podId || "");
    const policy = shadowPolicyStore.get(podId);
    if (!policy) return reply.code(404).send({ error: "policy_not_found" });
    return reply.send({ ok: true, policy });
  });

  const port = Number(process.env.SIGNER_PORT || 3010);
  await app.listen({ host: "0.0.0.0", port });
  app.log.info(`signer service listening on :${port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
