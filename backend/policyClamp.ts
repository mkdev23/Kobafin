/**
 * KobaFin V1.5 policy clamp
 * - Agent output is advisory.
 * - Hard floors and bounds are mandatory.
 * - Output is canonicalized to basis points for signer execution.
 */

export type PodTier = "LOW" | "MEDIUM" | "HIGH";
export type RiskState = "NORMAL" | "CAUTION" | "RISK_OFF";

export type AllocationPct = {
  usdc: number;
  btc: number;
  eth: number;
  sol: number;
};

export type AllocationBps = {
  usdc: number;
  btc: number;
  eth: number;
  sol: number;
};

export type AgentProposal = {
  podId: string;
  podTier: string;
  weightsPct: Partial<AllocationPct>;
  usdcInLuloPct?: number;
  riskState?: RiskState;
  reason?: string;
};

export type ClampedPolicy = {
  podId: string;
  podTier: PodTier;
  riskState: RiskState;
  targetAllocationsPct: AllocationPct;
  targetAllocationsBps: AllocationBps;
  usdcInLuloPct: number;
  usdcInLuloBps: number;
  reason: string;
  notes: string[];
};

type Bounds = {
  min: number;
  max: number;
};

type PodRules = {
  luloFloorPct: number;
  btc: Bounds;
  eth: Bounds;
  sol: Bounds;
};

const POD_RULES: Record<PodTier, PodRules> = {
  LOW: {
    luloFloorPct: 70,
    btc: { min: 0, max: 20 },
    eth: { min: 0, max: 15 },
    sol: { min: 0, max: 15 },
  },
  MEDIUM: {
    luloFloorPct: 50,
    btc: { min: 0, max: 30 },
    eth: { min: 0, max: 25 },
    sol: { min: 0, max: 25 },
  },
  HIGH: {
    luloFloorPct: 30,
    btc: { min: 0, max: 40 },
    eth: { min: 0, max: 30 },
    sol: { min: 0, max: 40 },
  },
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeTo100(weights: AllocationPct): AllocationPct {
  const sum = weights.usdc + weights.btc + weights.eth + weights.sol;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { usdc: 100, btc: 0, eth: 0, sol: 0 };
  }
  const scale = 100 / sum;
  return {
    usdc: weights.usdc * scale,
    btc: weights.btc * scale,
    eth: weights.eth * scale,
    sol: weights.sol * scale,
  };
}

function toBpsExact10000(weights: AllocationPct): AllocationBps {
  const raw = {
    usdc: weights.usdc * 100,
    btc: weights.btc * 100,
    eth: weights.eth * 100,
    sol: weights.sol * 100,
  };
  const floor = {
    usdc: Math.floor(raw.usdc),
    btc: Math.floor(raw.btc),
    eth: Math.floor(raw.eth),
    sol: Math.floor(raw.sol),
  };
  let remaining = 10_000 - (floor.usdc + floor.btc + floor.eth + floor.sol);

  const ranked = (
    [
      { k: "usdc", frac: raw.usdc - floor.usdc },
      { k: "btc", frac: raw.btc - floor.btc },
      { k: "eth", frac: raw.eth - floor.eth },
      { k: "sol", frac: raw.sol - floor.sol },
    ] as Array<{ k: keyof AllocationBps; frac: number }>
  ).sort((a, b) => b.frac - a.frac);

  let i = 0;
  while (remaining > 0) {
    const key = ranked[i % ranked.length].k;
    floor[key] += 1;
    remaining -= 1;
    i += 1;
  }

  return floor;
}

function normalizeTier(input: string): PodTier {
  const value = (input || "").trim().toUpperCase();
  if (value === "LOW") return "LOW";
  if (value === "MED" || value === "MEDIUM") return "MEDIUM";
  if (value === "HIGH") return "HIGH";
  return "LOW";
}

function normalizeRisk(input?: string): RiskState {
  const value = (input || "").trim().toUpperCase();
  if (value === "CAUTION") return "CAUTION";
  if (value === "RISK_OFF") return "RISK_OFF";
  return "NORMAL";
}

function boundCrypto(weights: AllocationPct, rules: PodRules, notes: string[]): AllocationPct {
  const btc = clamp(weights.btc, rules.btc.min, rules.btc.max);
  const eth = clamp(weights.eth, rules.eth.min, rules.eth.max);
  const sol = clamp(weights.sol, rules.sol.min, rules.sol.max);
  if (btc !== weights.btc || eth !== weights.eth || sol !== weights.sol) {
    notes.push("Clamped BTC/ETH/SOL to pod bounds.");
  }
  return { ...weights, btc, eth, sol };
}

function recomputeUsdcFromCrypto(weights: AllocationPct): AllocationPct {
  const btc = Math.max(0, weights.btc);
  const eth = Math.max(0, weights.eth);
  const sol = Math.max(0, weights.sol);
  const usdc = Math.max(0, 100 - (btc + eth + sol));
  return { usdc, btc, eth, sol };
}

function enforceUsdcMinimum(weights: AllocationPct, minUsdc: number, notes: string[]): AllocationPct {
  if (weights.usdc >= minUsdc) return weights;
  const cryptoSum = Math.max(0, weights.btc) + Math.max(0, weights.eth) + Math.max(0, weights.sol);
  const targetCryptoTotal = Math.max(0, 100 - minUsdc);
  if (cryptoSum <= 0) {
    return { usdc: minUsdc, btc: 0, eth: 0, sol: 0 };
  }

  // Keep USDC pinned to the floor and scale crypto to the remaining budget.
  const scale = targetCryptoTotal / cryptoSum;
  const btc = Math.max(0, weights.btc) * scale;
  const eth = Math.max(0, weights.eth) * scale;
  const sol = Math.max(0, weights.sol) * scale;
  notes.push("Raised USDC allocation to satisfy mandatory Lulo floor.");
  return {
    usdc: minUsdc,
    btc,
    eth,
    sol,
  };
}

export function applyPolicyClamp(input: AgentProposal): ClampedPolicy {
  const podTier = normalizeTier(input.podTier);
  const riskState = normalizeRisk(input.riskState);
  const rules = POD_RULES[podTier];
  const notes: string[] = [];

  const normalized = normalizeTo100({
    usdc: Math.max(0, Number(input.weightsPct.usdc ?? 0)),
    btc: Math.max(0, Number(input.weightsPct.btc ?? 0)),
    eth: Math.max(0, Number(input.weightsPct.eth ?? 0)),
    sol: Math.max(0, Number(input.weightsPct.sol ?? 0)),
  });

  let weights = boundCrypto(normalized, rules, notes);
  weights = recomputeUsdcFromCrypto(weights);

  weights = enforceUsdcMinimum(weights, rules.luloFloorPct, notes);
  weights = boundCrypto(weights, rules, notes);
  weights = recomputeUsdcFromCrypto(weights);
  if (weights.usdc < rules.luloFloorPct) {
    weights = enforceUsdcMinimum(weights, rules.luloFloorPct, notes);
    weights = boundCrypto(weights, rules, notes);
    weights = recomputeUsdcFromCrypto(weights);
  }

  const usdcInLuloPctRaw =
    input.usdcInLuloPct == null ? weights.usdc : Number(input.usdcInLuloPct);
  let usdcInLuloPct = clamp(usdcInLuloPctRaw, rules.luloFloorPct, 100);
  if (usdcInLuloPct > weights.usdc) {
    usdcInLuloPct = weights.usdc;
    notes.push("Adjusted usdc_in_lulo to not exceed total USDC allocation.");
  }
  if (usdcInLuloPct < rules.luloFloorPct) {
    usdcInLuloPct = rules.luloFloorPct;
    notes.push("Raised usdc_in_lulo to mandatory pod floor.");
  }
  if (usdcInLuloPct > weights.usdc) {
    // If weights.usdc equals the floor, this remains consistent.
    usdcInLuloPct = weights.usdc;
  }

  const targetAllocationsBps = toBpsExact10000(weights);
  const targetAllocationsPct: AllocationPct = {
    usdc: targetAllocationsBps.usdc / 100,
    btc: targetAllocationsBps.btc / 100,
    eth: targetAllocationsBps.eth / 100,
    sol: targetAllocationsBps.sol / 100,
  };

  const usdcInLuloBps = Math.min(
    targetAllocationsBps.usdc,
    Math.max(0, Math.round(usdcInLuloPct * 100))
  );

  return {
    podId: input.podId,
    podTier,
    riskState,
    targetAllocationsPct,
    targetAllocationsBps,
    usdcInLuloPct: usdcInLuloBps / 100,
    usdcInLuloBps,
    reason: input.reason || "Policy-governed target derived from advisory agent output.",
    notes,
  };
}
