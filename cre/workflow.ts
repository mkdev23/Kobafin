import {
  Runner,
  cre,
  consensusIdenticalAggregation,
  ok,
  text,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk";
import { applyPolicyClamp, type RiskState } from "../backend/policyClamp";

type WorkflowConfig = {
  schedule: string;
  govBackendBaseUrl: string;
  agentBaseUrl: string;
  signerBaseUrl: string;
  internalApiKey?: string;
  chainlinkSolanaBtcUsdUrl: string;
  chainlinkSolanaEthUsdUrl: string;
  chainlinkSolanaSolUsdUrl: string;
  wrapDivergenceCautionPct: number;
  wrapDivergenceRiskOffPct: number;
};

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

type GovernancePodsResponse = {
  pods: BackendPodSnapshot[];
};

type FeedResponse = {
  answer?: number | string;
  price?: number | string;
  data?: {
    answer?: number | string;
    price?: number | string;
  };
};

type AgentProposalResponse = {
  proposed_weights_pct: { usdc: number; btc: number; eth: number; sol: number };
  proposed_usdc_in_lulo_pct?: number;
  usdc_in_lulo_pct?: number;
  proposed_risk_state: RiskState;
  reason: string;
};

type SignerUpdateResponse = {
  ok?: boolean;
  signature?: string | null;
  simulated?: boolean;
  warning?: string;
  [key: string]: unknown;
};

type PodResult = {
  pod_id: string;
  risk_state: RiskState;
  divergence_pct: number;
  signer_signature: string | null;
  simulated: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseConfig(bytes: Uint8Array): WorkflowConfig {
  const raw = decoder.decode(bytes);
  const cfg = JSON.parse(raw) as Partial<WorkflowConfig>;
  return {
    schedule: cfg.schedule || "*/15 * * * *",
    govBackendBaseUrl: String(cfg.govBackendBaseUrl || "http://localhost:3001"),
    agentBaseUrl: String(cfg.agentBaseUrl || "http://localhost:3020"),
    signerBaseUrl: String(cfg.signerBaseUrl || "http://localhost:3010"),
    internalApiKey: cfg.internalApiKey || "",
    chainlinkSolanaBtcUsdUrl: String(cfg.chainlinkSolanaBtcUsdUrl || ""),
    chainlinkSolanaEthUsdUrl: String(cfg.chainlinkSolanaEthUsdUrl || ""),
    chainlinkSolanaSolUsdUrl: String(cfg.chainlinkSolanaSolUsdUrl || ""),
    wrapDivergenceCautionPct: Number(cfg.wrapDivergenceCautionPct ?? 2),
    wrapDivergenceRiskOffPct: Number(cfg.wrapDivergenceRiskOffPct ?? 5),
  };
}

function nodeGet(runtime: Runtime<WorkflowConfig>, url: string, headers: Record<string, string>): string {
  const http = new cre.capabilities.HTTPClient();
  const fn = runtime.runInNodeMode(
    (nodeRuntime: NodeRuntime<WorkflowConfig>, input: { url: string; headers: Record<string, string> }) => {
      const res = http.sendRequest(nodeRuntime, { method: "GET", url: input.url, headers: input.headers }).result();
      if (!ok(res)) {
        throw new Error(`http_get_failed:${res.statusCode}:${input.url}`);
      }
      return text(res);
    },
    consensusIdenticalAggregation<string>()
  );
  return fn({ url, headers }).result();
}

function nodePost(
  runtime: Runtime<WorkflowConfig>,
  url: string,
  headers: Record<string, string>,
  body: unknown
): string {
  const http = new cre.capabilities.HTTPClient();
  const fn = runtime.runInNodeMode(
    (
      nodeRuntime: NodeRuntime<WorkflowConfig>,
      input: { url: string; headers: Record<string, string>; body: string }
    ) => {
      const res = http
        .sendRequest(nodeRuntime, {
          method: "POST",
          url: input.url,
          headers: input.headers,
          body: encoder.encode(input.body),
        })
        .result();
      if (!ok(res)) {
        throw new Error(`http_post_failed:${res.statusCode}:${input.url}`);
      }
      return text(res);
    },
    consensusIdenticalAggregation<string>()
  );
  return fn({ url, headers, body: JSON.stringify(body) }).result();
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
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
  runtime: Runtime<WorkflowConfig>
): number {
  if (!Number.isFinite(spotUsdcPerAsset) || spotUsdcPerAsset <= 0) {
    runtime.log(`invalid dex spot for ${label}; using oracle fallback`);
    return oracleUsdPerAsset;
  }
  if (spotUsdcPerAsset > oracleUsdPerAsset * 20 || spotUsdcPerAsset < oracleUsdPerAsset / 20) {
    runtime.log(`spot/oracle scale mismatch for ${label}; using oracle fallback`);
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

function makeHeaders(cfg: WorkflowConfig, runId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-cre-run-id": runId,
  };
  if (cfg.internalApiKey) headers["x-internal-key"] = cfg.internalApiKey;
  return headers;
}

function execute(runtime: Runtime<WorkflowConfig>): { run_id: string; results: PodResult[] } {
  const cfg = runtime.config;
  const runId = new Date().toISOString();
  const headers = makeHeaders(cfg, runId);
  runtime.log(`governance_run_start ${runId}`);

  const podsRaw = nodeGet(runtime, `${cfg.govBackendBaseUrl}/v1/governance/pods`, headers);
  const podsResponse = parseJson<GovernancePodsResponse>(podsRaw);
  const results: PodResult[] = [];

  for (const pod of podsResponse.pods) {
    runtime.log(`governance_pod_start ${pod.pod_id}`);

    const btcFeed = parseJson<FeedResponse>(
      nodeGet(runtime, cfg.chainlinkSolanaBtcUsdUrl, headers)
    );
    const ethFeed = parseJson<FeedResponse>(
      nodeGet(runtime, cfg.chainlinkSolanaEthUsdUrl, headers)
    );
    const solFeed = parseJson<FeedResponse>(
      nodeGet(runtime, cfg.chainlinkSolanaSolUsdUrl, headers)
    );

    const btcOracle = feedValue(btcFeed, pod.dex_spot_prices.btcb_usdc);
    const ethOracle = feedValue(ethFeed, pod.dex_spot_prices.weth_usdc);
    const solOracle = feedValue(solFeed, pod.dex_spot_prices.sol_usdc);

    // Apples-to-apples quote check:
    // DEX spot is USDC-per-asset and oracle is USD-per-asset (USDC ~= USD).
    const btcbSpot = sanitizeUsdcPerAssetSpot(
      "BTC.b/USDC",
      pod.dex_spot_prices.btcb_usdc,
      btcOracle,
      runtime
    );
    const wethSpot = sanitizeUsdcPerAssetSpot(
      "WETH/USDC",
      pod.dex_spot_prices.weth_usdc,
      ethOracle,
      runtime
    );

    const btcbDiv = divergencePct(btcbSpot, btcOracle);
    const wethDiv = divergencePct(wethSpot, ethOracle);
    const maxDiv = Math.max(btcbDiv, wethDiv);

    const divergenceRisk = riskFromDivergence(
      maxDiv,
      cfg.wrapDivergenceCautionPct,
      cfg.wrapDivergenceRiskOffPct
    );

    const agentRaw = nodePost(runtime, `${cfg.agentBaseUrl}/propose`, headers, {
      pod_id: pod.pod_id,
      pod_tier: pod.pod_tier,
      oracle_prices: {
        btc_usd: btcOracle,
        eth_usd: ethOracle,
        sol_usd: solOracle,
      },
      dex_spot_prices: {
        btcb_usdc: btcbSpot,
        weth_usdc: wethSpot,
        sol_usdc: pod.dex_spot_prices.sol_usdc,
      },
      divergence: {
        btcb_pct: btcbDiv,
        weth_pct: wethDiv,
        max_pct: maxDiv,
      },
      current_state: {
        weights_pct: pod.current_weights_pct,
        risk_state: pod.current_risk_state,
      },
      volatility: {},
    });

    const agent = parseJson<AgentProposalResponse>(agentRaw);
    const mergedRisk = maxRisk(agent.proposed_risk_state, divergenceRisk);
    const requestedUsdcInLuloPct =
      agent.proposed_usdc_in_lulo_pct ?? agent.usdc_in_lulo_pct ?? pod.policy.min_usdc_in_lulo_pct;

    const clamped = applyPolicyClamp({
      podId: pod.pod_id,
      podTier: pod.pod_tier,
      weightsPct: agent.proposed_weights_pct,
      usdcInLuloPct: requestedUsdcInLuloPct,
      riskState: mergedRisk,
      reason: agent.reason,
    });

    const signerRaw = nodePost(runtime, `${cfg.signerBaseUrl}/update_policy`, headers, {
      pod_id: pod.pod_id,
      target_allocations_bps: clamped.targetAllocationsBps,
      usdc_in_lulo_bps: clamped.usdcInLuloBps,
      risk_state: clamped.riskState,
      reason: clamped.reason,
    });

    const signer = parseJson<SignerUpdateResponse>(signerRaw);
    results.push({
      pod_id: pod.pod_id,
      risk_state: clamped.riskState,
      divergence_pct: maxDiv,
      signer_signature: signer.signature ?? null,
      simulated: Boolean(signer.simulated),
    });
  }

  runtime.log(`governance_run_complete ${runId} pods=${results.length}`);
  return { run_id: runId, results };
}

function initWorkflow(config: WorkflowConfig) {
  const cron = new cre.capabilities.CronCapability();
  const trigger = cron.trigger({ schedule: config.schedule });
  return [cre.handler(trigger, (runtime) => execute(runtime))];
}

export async function main() {
  const runner = await Runner.newRunner<WorkflowConfig>({ configParser: parseConfig });
  await runner.run((config) => initWorkflow(config));
}

await main();
