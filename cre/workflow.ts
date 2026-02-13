import { applyPolicyClamp, RiskState } from "../backend/policyClamp";

/**
 * Chainlink CRE workflow for KobaFin V1.5.
 *
 * Trigger:
 * - Scheduled cron execution (configured in `cre/config.yaml`).
 *
 * Capabilities used:
 * - HTTPClient capability: backend state, Chainlink feed reads, agent proposal, signer update.
 * - Onchain read/write capability: read pod config account and write workflow audit marker.
 *
 * Chainlink reference:
 * - Solana Data Feeds are treated as canonical price source for BTC/USD, ETH/USD, SOL/USD.
 * - Feed endpoints are injected via env to align with the active CRE deployment docs/config.
 */

type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type HttpResponse<T> = {
  statusCode: number;
  data: T;
};

interface HttpClientCapability {
  request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
}

interface OnchainCapability {
  readPodConfig(podId: string): Promise<{
    pod_id: string;
    risk_state: RiskState;
    target_allocations_bps: { usdc: number; btc: number; eth: number; sol: number };
    usdc_in_lulo_bps: number;
  }>;
  writeWorkflowAudit(input: {
    pod_id: string;
    run_id: string;
    risk_state: RiskState;
    target_allocations_bps: { usdc: number; btc: number; eth: number; sol: number };
    usdc_in_lulo_bps: number;
  }): Promise<{ signature: string }>;
}

interface WorkflowContext {
  http: HttpClientCapability;
  onchain: OnchainCapability;
  env: Record<string, string | undefined>;
  trigger: {
    type: "cron" | "event";
    firedAt: string;
  };
  logger: {
    info(v: unknown, msg?: string): void;
    warn(v: unknown, msg?: string): void;
    error(v: unknown, msg?: string): void;
  };
}

type BackendPodSnapshot = {
  pod_id: string;
  pod_tier: "LOW" | "MEDIUM" | "HIGH";
  current_weights_pct: { usdc: number; btc: number; eth: number; sol: number };
  current_risk_state: RiskState;
  policy: {
    min_usdc_in_lulo_pct: number;
    max_btc_pct: number;
    max_eth_pct: number;
    max_sol_pct: number;
  };
  dex_spot_prices: {
    btcb_usdc: number;
    weth_usdc: number;
    sol_usdc: number;
  };
};

type AgentProposalResponse = {
  proposed_weights_pct: { usdc: number; btc: number; eth: number; sol: number };
  proposed_usdc_in_lulo_pct?: number;
  usdc_in_lulo_pct?: number;
  proposed_risk_state: RiskState;
  reason: string;
};

type FeedResponse = {
  answer?: number | string;
  price?: number | string;
  updatedAt?: string;
  data?: {
    answer?: number | string;
    price?: number | string;
    updatedAt?: string;
  };
};

type WorkflowPodResult = {
  pod_id: string;
  risk_state: RiskState;
  signer_signature?: string;
  audit_signature?: string;
  divergence_pct: number;
};

export const metadata = {
  workflow_id: "kobafin-v1_5-governance",
  trigger: "cron",
  schedule: "*/15 * * * *",
};

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

async function httpJson<T>(ctx: WorkflowContext, req: HttpRequest): Promise<T> {
  const res = await ctx.http.request<T>(req);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`http_error:${res.statusCode}:${req.method}:${req.url}`);
  }
  return res.data;
}

function feedValue(feed: FeedResponse, fallback: number): number {
  const raw = feed.answer ?? feed.price ?? feed.data?.answer ?? feed.data?.price ?? fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function divergencePct(spot: number, oracle: number): number {
  if (!Number.isFinite(spot) || !Number.isFinite(oracle) || oracle <= 0) return 0;
  return Math.abs((spot - oracle) / oracle) * 100;
}

function sanitizeUsdcPerAssetSpot(
  label: string,
  spotUsdcPerAsset: number,
  oracleUsdPerAsset: number,
  logger: WorkflowContext["logger"]
): number {
  if (!Number.isFinite(spotUsdcPerAsset) || spotUsdcPerAsset <= 0) {
    logger.warn(
      { label, spot: spotUsdcPerAsset, oracle: oracleUsdPerAsset },
      "invalid dex spot quote; falling back to oracle for divergence calculation"
    );
    return oracleUsdPerAsset;
  }

  // Guardrail: reject obviously malformed quote scales to keep divergence apples-to-apples.
  // We compare USDC-per-asset DEX spot vs USD-per-asset oracle (USDC ~= USD).
  if (spotUsdcPerAsset > oracleUsdPerAsset * 20 || spotUsdcPerAsset < oracleUsdPerAsset / 20) {
    logger.warn(
      { label, spot: spotUsdcPerAsset, oracle: oracleUsdPerAsset },
      "dex spot quote scale looks invalid; falling back to oracle for divergence calculation"
    );
    return oracleUsdPerAsset;
  }

  return spotUsdcPerAsset;
}

function maxRisk(a: RiskState, b: RiskState): RiskState {
  const rank: Record<RiskState, number> = { NORMAL: 0, CAUTION: 1, RISK_OFF: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function riskFromDivergence(maxDivPct: number, cautionThreshold: number, riskOffThreshold: number): RiskState {
  if (maxDivPct >= riskOffThreshold) return "RISK_OFF";
  if (maxDivPct >= cautionThreshold) return "CAUTION";
  return "NORMAL";
}

/**
 * Main CRE handler.
 * Uses HTTPClient single-execution pattern by setting an idempotency key per pod/run.
 */
export async function run(ctx: WorkflowContext): Promise<{ results: WorkflowPodResult[] }> {
  const backendBase = required(ctx.env, "GOV_BACKEND_BASE_URL");
  const agentBase = required(ctx.env, "AGENT_BASE_URL");
  const signerBase = required(ctx.env, "SIGNER_BASE_URL");
  const internalKey = ctx.env.INTERNAL_API_KEY || "";
  const cautionThreshold = Number(ctx.env.WRAP_DIVERGENCE_CAUTION_PCT || "2");
  const riskOffThreshold = Number(ctx.env.WRAP_DIVERGENCE_RISK_OFF_PCT || "5");

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (internalKey) headers["x-internal-key"] = internalKey;

  const pods = await httpJson<{ pods: BackendPodSnapshot[] }>(ctx, {
    method: "GET",
    url: `${backendBase}/v1/governance/pods`,
    headers,
  });

  const btcFeedUrl = required(ctx.env, "CHAINLINK_SOLANA_BTC_USD_URL");
  const ethFeedUrl = required(ctx.env, "CHAINLINK_SOLANA_ETH_USD_URL");
  const solFeedUrl = required(ctx.env, "CHAINLINK_SOLANA_SOL_USD_URL");

  const results: WorkflowPodResult[] = [];
  const runId = `${ctx.trigger.firedAt}`;

  for (const pod of pods.pods) {
    // Onchain read: current authoritative config account state.
    const onchainState = await ctx.onchain.readPodConfig(pod.pod_id);

    const [btcFeed, ethFeed, solFeed] = await Promise.all([
      httpJson<FeedResponse>(ctx, { method: "GET", url: btcFeedUrl, headers }),
      httpJson<FeedResponse>(ctx, { method: "GET", url: ethFeedUrl, headers }),
      httpJson<FeedResponse>(ctx, { method: "GET", url: solFeedUrl, headers }),
    ]);

    const btcOracle = feedValue(btcFeed, pod.dex_spot_prices.btcb_usdc);
    const ethOracle = feedValue(ethFeed, pod.dex_spot_prices.weth_usdc);
    const solOracle = feedValue(solFeed, pod.dex_spot_prices.sol_usdc);

    // Apples-to-apples divergence check:
    // - DEX spot must be quoted as USDC per 1 BTC.b / WETH.
    // - Chainlink feeds are USD per 1 BTC / ETH.
    // - We compare them directly under USDC ~= USD assumption with quote-format guardrails.
    const btcbSpot = sanitizeUsdcPerAssetSpot(
      "BTC.b/USDC",
      pod.dex_spot_prices.btcb_usdc,
      btcOracle,
      ctx.logger
    );
    const wethSpot = sanitizeUsdcPerAssetSpot(
      "WETH/USDC",
      pod.dex_spot_prices.weth_usdc,
      ethOracle,
      ctx.logger
    );

    const btcbDiv = divergencePct(btcbSpot, btcOracle);
    const wethDiv = divergencePct(wethSpot, ethOracle);
    const maxDiv = Math.max(btcbDiv, wethDiv);

    const divergenceRisk = riskFromDivergence(maxDiv, cautionThreshold, riskOffThreshold);

    const agent = await httpJson<AgentProposalResponse>(ctx, {
      method: "POST",
      url: `${agentBase}/propose`,
      headers,
      body: {
        pod_id: pod.pod_id,
        pod_tier: pod.pod_tier,
        oracle_prices: {
          btc_usd: btcOracle,
          eth_usd: ethOracle,
          sol_usd: solOracle,
        },
        dex_spot_prices: {
          ...pod.dex_spot_prices,
          btcb_usdc: btcbSpot,
          weth_usdc: wethSpot,
        },
        divergence: {
          btcb_pct: btcbDiv,
          weth_pct: wethDiv,
          max_pct: maxDiv,
        },
        current_state: {
          weights_pct: pod.current_weights_pct,
          risk_state: onchainState.risk_state,
        },
        volatility: {},
      },
    });

    const mergedRisk = maxRisk(agent.proposed_risk_state, divergenceRisk);
    const onchainUsdcInLuloPct = Math.max(0, onchainState.usdc_in_lulo_bps / 100);
    const agentUsdcInLuloPctRaw =
      agent.proposed_usdc_in_lulo_pct ?? agent.usdc_in_lulo_pct;
    const requestedUsdcInLuloPct =
      agentUsdcInLuloPctRaw == null
        ? onchainUsdcInLuloPct
        : Number(agentUsdcInLuloPctRaw);

    const clamped = applyPolicyClamp({
      podId: pod.pod_id,
      podTier: pod.pod_tier,
      weightsPct: agent.proposed_weights_pct,
      usdcInLuloPct: requestedUsdcInLuloPct,
      riskState: mergedRisk,
      reason: agent.reason,
    });

    // HTTP write: signer is the execution boundary for onchain policy update tx.
    const signerHeaders = {
      ...headers,
      "x-idempotency-key": `${pod.pod_id}:${runId}`,
    };
    const signerRes = await httpJson<{ signature?: string }>(ctx, {
      method: "POST",
      url: `${signerBase}/update_policy`,
      headers: signerHeaders,
      body: {
        pod_id: pod.pod_id,
        target_allocations_bps: clamped.targetAllocationsBps,
        usdc_in_lulo_bps: clamped.usdcInLuloBps,
        risk_state: clamped.riskState,
        reason: clamped.reason,
      },
    });

    // Onchain write: workflow audit marker for traceability.
    const audit = await ctx.onchain.writeWorkflowAudit({
      pod_id: pod.pod_id,
      run_id: runId,
      risk_state: clamped.riskState,
      target_allocations_bps: clamped.targetAllocationsBps,
      usdc_in_lulo_bps: clamped.usdcInLuloBps,
    });

    ctx.logger.info(
      {
        pod_id: pod.pod_id,
        divergence_pct: maxDiv,
        risk_state: clamped.riskState,
        target_allocations_bps: clamped.targetAllocationsBps,
        usdc_in_lulo_bps: clamped.usdcInLuloBps,
      },
      "pod policy updated"
    );

    results.push({
      pod_id: pod.pod_id,
      divergence_pct: maxDiv,
      risk_state: clamped.riskState,
      signer_signature: signerRes.signature,
      audit_signature: audit.signature,
    });
  }

  return { results };
}
