import "dotenv/config";

type AnyJson = Record<string, any>;

const apiBase = process.env.SMOKE_API_BASE || "http://localhost:3001";
const signerBase = process.env.SMOKE_SIGNER_BASE || "http://localhost:3010";
const agentBase = process.env.SMOKE_AGENT_BASE || "http://localhost:3020";
const internalKey = process.env.INTERNAL_API_KEY || "";

function toBpsExact10000(weightsPct: { usdc: number; btc: number; eth: number; sol: number }) {
  const raw = {
    usdc: weightsPct.usdc * 100,
    btc: weightsPct.btc * 100,
    eth: weightsPct.eth * 100,
    sol: weightsPct.sol * 100,
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
    ] as Array<{ key: keyof typeof out; frac: number }>
  ).sort((a, b) => b.frac - a.frac);
  let i = 0;
  while (remainder > 0) {
    out[ranked[i % ranked.length].key] += 1;
    remainder -= 1;
    i += 1;
  }
  return out;
}

async function request(method: "GET" | "POST", url: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: AnyJson | null = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function fail(message: string, context?: unknown): never {
  // eslint-disable-next-line no-console
  console.error(`SMOKE FAIL: ${message}`);
  if (context) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(context, null, 2));
  }
  process.exit(1);
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(`SMOKE: api=${apiBase} signer=${signerBase} agent=${agentBase}`);

  const [apiHealth, signerHealth, agentHealth] = await Promise.all([
    request("GET", `${apiBase}/health`),
    request("GET", `${signerBase}/health`),
    request("GET", `${agentBase}/health`),
  ]);

  if (!apiHealth.ok) fail("api health failed", apiHealth);
  if (!signerHealth.ok) fail("signer health failed", signerHealth);
  if (!agentHealth.ok) fail("agent health failed", agentHealth);

  const governance = await request("GET", `${apiBase}/v1/governance/pods`, undefined, {
    ...(internalKey ? { "x-internal-key": internalKey } : {}),
  });
  if (!governance.ok) fail("governance pods route failed", governance);
  const pods = Array.isArray(governance.json?.pods) ? governance.json!.pods : [];
  if (!pods.length) {
    // eslint-disable-next-line no-console
    console.log("SMOKE: no pots found. Create at least one pot, then re-run.");
    process.exit(0);
  }
  const pod = pods[0];

  const agentReq = {
    pod_id: pod.pod_id,
    pod_tier: pod.pod_tier,
    oracle_prices: {
      btc_usd: pod.dex_spot_prices.btcb_usdc,
      eth_usd: pod.dex_spot_prices.weth_usdc,
      sol_usd: pod.dex_spot_prices.sol_usdc,
    },
    dex_spot_prices: pod.dex_spot_prices,
    divergence: { btcb_pct: 0, weth_pct: 0, max_pct: 0 },
    current_state: {
      weights_pct: pod.current_weights_pct,
      risk_state: pod.current_risk_state || "NORMAL",
    },
    volatility: {},
  };
  const agentRes = await request("POST", `${agentBase}/propose`, agentReq);
  if (!agentRes.ok) fail("agent propose failed", agentRes);

  const proposal = agentRes.json?.proposed_weights_pct;
  if (!proposal) fail("agent returned no proposed_weights_pct", agentRes);
  const targetBps = toBpsExact10000(proposal);

  const minUsdcLulo = Number(pod?.policy?.min_usdc_in_lulo_pct || 0);
  const requestedUsdcInLuloBps = Math.max(0, Math.round(minUsdcLulo * 100));
  const usdcInLuloBps = Math.min(targetBps.usdc, requestedUsdcInLuloBps);

  const signerReq = {
    pod_id: pod.pod_id,
    target_allocations_bps: targetBps,
    usdc_in_lulo_bps: usdcInLuloBps,
    risk_state: agentRes.json?.proposed_risk_state || "NORMAL",
    reason: `smoke:v15 ${new Date().toISOString()}`,
  };
  const signerRes = await request("POST", `${signerBase}/update_policy`, signerReq);
  if (!signerRes.ok) fail("signer update_policy failed", signerRes);

  // eslint-disable-next-line no-console
  console.log("SMOKE PASS");
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        pod_id: pod.pod_id,
        agent: agentRes.json,
        signer: signerRes.json,
      },
      null,
      2
    )
  );
}

main().catch((err) => fail("unhandled error", { message: String(err) }));
