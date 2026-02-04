import type { LuloRates, StrategyId } from "@/lib/api";

export type LuloMode = "protected" | "regular";

export function luloModeForStrategy(strategyId?: StrategyId | null): LuloMode {
  return strategyId === "high" ? "regular" : "protected";
}

export function apyFromRates(rates: LuloRates | null, mode: LuloMode): number | null {
  if (!rates) return null;
  const group = rates[mode];
  if (!group) return null;
  const val = group.CURRENT ?? (group as any)["CURRENT"];
  return typeof val === "number" ? val : null;
}
