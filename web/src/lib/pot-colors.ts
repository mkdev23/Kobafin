import type { Pot } from "@/lib/api";

export type PotColor = "blue" | "purple" | "green";

const STRATEGY_COLOR: Record<string, PotColor> = {
  low: "blue",
  med: "purple",
  high: "green",
  LOW: "blue",
  MED: "purple",
  HIGH: "green",
};

const FALLBACK: PotColor[] = ["blue", "purple", "green"];

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
  return "linear-gradient(180deg, #0a57e8, #0a4fe0)";
}
