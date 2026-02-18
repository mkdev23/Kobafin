import type { Pot } from "@/lib/api";

export type PotColor = "blue" | "purple" | "green" | "orange";

const STRATEGY_COLOR: Record<string, PotColor> = {
  conservative: "blue",
  balanced: "purple",
  aggressive: "green",
  ultra: "orange",
  // Legacy support
  low: "blue",
  med: "purple",
  high: "green",
  LOW: "blue",
  CONSERVATIVE: "blue",
  MED: "purple",
  BALANCED: "purple",
  HIGH: "green",
  AGGRESSIVE: "green",
  ULTRA: "orange",
};

const FALLBACK: PotColor[] = ["blue", "purple", "green", "orange"];

export function colorForPot(pot?: Partial<Pot> | null, index = 0): PotColor {
  const fromStrategy = pot?.strategyId ? STRATEGY_COLOR[pot.strategyId] : undefined;
  if (fromStrategy) return fromStrategy;
  const fromRisk = pot?.riskTier ? STRATEGY_COLOR[pot.riskTier] : undefined;
  if (fromRisk) return fromRisk;
  return FALLBACK[index % FALLBACK.length];
}

export function heroGradient(color: PotColor): string {
  if (color === "purple") return "linear-gradient(180deg, #6c0a7d, #5a0968)";
  if (color === "green") return "linear-gradient(180deg, #0b7a22, #09681d)";
  if (color === "orange") return "linear-gradient(180deg, #c2410c, #9a3412)";
  return "linear-gradient(180deg, #0a57e8, #0a4fe0)";
}
