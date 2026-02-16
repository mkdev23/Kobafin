import { createServer, IncomingMessage, ServerResponse } from "node:http";

type PodTier = "LOW" | "MEDIUM" | "HIGH";
type RiskState = "NORMAL" | "CAUTION" | "RISK_OFF";
type AgentMode = "rules" | "llm" | "auto";

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

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 12_000);
const agentMode = ((process.env.AGENT_MODE || "auto").toLowerCase() as AgentMode);

function parseTier(value: string): PodTier {
  const v = (value || "").toUpperCase();
  if (v === "LOW") return "LOW";
  if (v === "MEDIUM" || v === "MED") return "MEDIUM";
  return "HIGH";
}

function parseRiskState(value: unknown): RiskState | null {
  const v = String(value || "").toUpperCase();
  if (v === "NORMAL" || v === "CAUTION" || v === "RISK_OFF") return v;
  return null;
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

function proposeRules(features: FeaturesRequest): AgentResponse {
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

type LlmProposal = {
  proposed_weights_pct?: {
    usdc?: number;
    btc?: number;
    eth?: number;
    sol?: number;
  };
  proposed_risk_state?: string;
  reason?: string;
};

function sanitizeWeights(input?: LlmProposal["proposed_weights_pct"]) {
  return {
    usdc: Math.max(0, Number(input?.usdc ?? 0)),
    btc: Math.max(0, Number(input?.btc ?? 0)),
    eth: Math.max(0, Number(input?.eth ?? 0)),
    sol: Math.max(0, Number(input?.sol ?? 0)),
  };
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw;
}

async function callOpenAI(features: FeaturesRequest, baselineProposal: AgentResponse): Promise<AgentResponse> {
  const timeout = Number.isFinite(AGENT_TIMEOUT_MS) ? Math.max(1_000, AGENT_TIMEOUT_MS) : 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const systemPrompt = [
    "You are KobaFin's risk-advisory allocator for pod portfolios.",
    "Return only JSON with fields: proposed_weights_pct, proposed_risk_state, reason.",
    "Risk state must be one of: NORMAL, CAUTION, RISK_OFF.",
    "proposed_weights_pct must include usdc, btc, eth, sol as numeric percentages.",
    "Do not include markdown or extra keys."
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Propose advisory allocation for a single pod using provided features.",
      constraints: {
        advisory_only: true,
        hard_policy_enforced_elsewhere: true,
      },
      baseline: baselineProposal,
      features,
      output_shape: {
        proposed_weights_pct: { usdc: "number", btc: "number", eth: "number", sol: "number" },
        proposed_risk_state: "NORMAL|CAUTION|RISK_OFF",
        reason: "string",
      },
    },
    null,
    2
  );

  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`openai_http_${res.status}:${errBody.slice(0, 200)}`);
    }

    const payload = (await res.json()) as any;
    const content = String(payload?.choices?.[0]?.message?.content || "");
    if (!content) throw new Error("openai_empty_content");

    const parsed = JSON.parse(extractJsonObject(content)) as LlmProposal;
    const risk = parseRiskState(parsed.proposed_risk_state);
    if (!risk) throw new Error("openai_invalid_risk_state");

    const weights = normalize(sanitizeWeights(parsed.proposed_weights_pct));
    const reason = String(parsed.reason || "").trim() || "LLM advisory proposal";
    return {
      proposed_weights_pct: weights,
      proposed_risk_state: risk,
      reason,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function propose(features: FeaturesRequest): Promise<{ output: AgentResponse; source: "rules" | "llm" }> {
  const fallback = proposeRules(features);
  const llmEnabled = Boolean(OPENAI_API_KEY);

  if (agentMode === "rules") {
    return { output: fallback, source: "rules" };
  }

  if ((agentMode === "llm" || agentMode === "auto") && llmEnabled) {
    try {
      const llm = await callOpenAI(features, fallback);
      return { output: llm, source: "llm" };
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          msg: "agent_llm_fallback",
          error: err?.message || String(err),
        })
      );
      if (agentMode === "llm") throw err;
      return { output: fallback, source: "rules" };
    }
  }

  return { output: fallback, source: "rules" };
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
    return json(res, 200, {
      ok: true,
      service: "kobafin-agent",
      mode: agentMode,
      llm_enabled: Boolean(OPENAI_API_KEY),
      model: OPENAI_MODEL,
    });
  }

  if (req.method === "POST" && req.url === "/propose") {
    try {
      const creRunId = String(req.headers["x-cre-run-id"] || "");
      const body = (await readJson(req)) as FeaturesRequest;
      const { output, source } = await propose(body);
      if (creRunId) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            msg: "agent_propose",
            creRunId,
            pod_id: body.pod_id,
            pod_tier: body.pod_tier,
            source,
            proposed_risk_state: output.proposed_risk_state,
          })
        );
      }
      return json(res, 200, output);
    } catch (err: any) {
      return json(res, 400, { error: err?.message || "bad_request" });
    }
  }

  return json(res, 404, { error: "not_found" });
});

const port = Number(process.env.AGENT_PORT || 3020);
server.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(
    `agent service listening on :${port} mode=${agentMode} llm_enabled=${Boolean(OPENAI_API_KEY)} model=${OPENAI_MODEL}`
  );
});
