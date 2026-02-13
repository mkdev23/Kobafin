import { createServer, IncomingMessage, ServerResponse } from "node:http";

type PodTier = "LOW" | "MEDIUM" | "HIGH";
type RiskState = "NORMAL" | "CAUTION" | "RISK_OFF";

type FeaturesRequest = {
  pod_id: string;
  pod_tier: PodTier;
  oracle_prices: {
    btc_usd: number;
    eth_usd: number;
    sol_usd: number;
  };
  dex_spot_prices: {
    btcb_usdc: number;
    weth_usdc: number;
  };
  divergence: {
    btcb_pct: number;
    weth_pct: number;
    max_pct: number;
  };
  current_state: {
    weights_pct: {
      usdc: number;
      btc: number;
      eth: number;
      sol: number;
    };
    risk_state: RiskState;
  };
  volatility: {
    btc_24h_pct?: number;
    eth_24h_pct?: number;
    sol_24h_pct?: number;
  };
};

type AgentResponse = {
  proposed_weights_pct: {
    usdc: number;
    btc: number;
    eth: number;
    sol: number;
  };
  proposed_risk_state: RiskState;
  reason: string;
};

function parseTier(value: string): PodTier {
  const v = (value || "").toUpperCase();
  if (v === "LOW") return "LOW";
  if (v === "MEDIUM" || v === "MED") return "MEDIUM";
  return "HIGH";
}

function normalize(weights: AgentResponse["proposed_weights_pct"]) {
  const sum = weights.usdc + weights.btc + weights.eth + weights.sol;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { usdc: 100, btc: 0, eth: 0, sol: 0 };
  }
  const k = 100 / sum;
  return {
    usdc: weights.usdc * k,
    btc: weights.btc * k,
    eth: weights.eth * k,
    sol: weights.sol * k,
  };
}

function baseline(tier: PodTier) {
  if (tier === "LOW") return { usdc: 78, btc: 12, eth: 6, sol: 4 };
  if (tier === "MEDIUM") return { usdc: 60, btc: 20, eth: 12, sol: 8 };
  return { usdc: 42, btc: 24, eth: 18, sol: 16 };
}

function propose(features: FeaturesRequest): AgentResponse {
  const tier = parseTier(features.pod_tier);
  let w = baseline(tier);
  let risk: RiskState = "NORMAL";
  const reasons: string[] = [];

  if (features.divergence.max_pct >= 5) {
    risk = "RISK_OFF";
    w = { usdc: 100, btc: 0, eth: 0, sol: 0 };
    reasons.push("Severe wrapped-asset divergence; switched to risk-off posture.");
  } else if (features.divergence.max_pct >= 2) {
    risk = "CAUTION";
    w.usdc += 8;
    w.btc -= 3;
    w.eth -= 3;
    w.sol -= 2;
    reasons.push("Moderate divergence; reduced risk assets and increased USDC.");
  }

  const volMax = Math.max(
    Number(features.volatility.btc_24h_pct || 0),
    Number(features.volatility.eth_24h_pct || 0),
    Number(features.volatility.sol_24h_pct || 0)
  );
  if (volMax >= 7 && risk !== "RISK_OFF") {
    risk = "CAUTION";
    w.usdc += 5;
    w.sol -= 3;
    w.eth -= 2;
    reasons.push("High short-term volatility; de-risked discretionary assets.");
  }

  return {
    proposed_weights_pct: normalize(w),
    proposed_risk_state: risk,
    reason: reasons.join(" ") || "Baseline tier allocation with no exceptional risk signals.",
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "kobafin-agent-stub" });
  }

  if (req.method === "POST" && req.url === "/propose") {
    try {
      const body = (await readJson(req)) as FeaturesRequest;
      const out = propose(body);
      return json(res, 200, out);
    } catch (err: any) {
      return json(res, 400, { error: err?.message || "bad_request" });
    }
  }

  return json(res, 404, { error: "not_found" });
});

const port = Number(process.env.AGENT_PORT || 3020);
server.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`agent service listening on :${port}`);
});

