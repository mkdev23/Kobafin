"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Strategy, StrategyId } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const STRATEGY_OPTIONS = [
  {
    value: "conservative" as StrategyId,
    label: "Conservative",
    description: "Capital preservation with stable yield. Mostly USDC in protected lending.",
    allocation: "70% USDC · 15% BTC · 10% ETH · 5% SOL",
  },
  {
    value: "balanced" as StrategyId,
    label: "Balanced",
    description: "Moderate growth with downside protection. Split between stable yield and crypto.",
    allocation: "40% USDC · 25% BTC · 20% ETH · 15% SOL",
  },
  {
    value: "aggressive" as StrategyId,
    label: "Aggressive",
    description: "Higher crypto allocation for growth. Boosted yield with significant market exposure.",
    allocation: "20% USDC · 30% BTC · 25% ETH · 25% SOL",
  },
  {
    value: "ultra" as StrategyId,
    label: "Ultra",
    description: "Maximum crypto exposure. Minimal stablecoin. Fully boosted yield. High volatility expected.",
    allocation: "10% USDC · 35% BTC · 30% ETH · 25% SOL",
  },
] as const;

export default function CreatePotPage() {
  const router = useRouter();
  const { token, isReady } = useAuth();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [theme, setTheme] = useState("");
  const [risk, setRisk] = useState<"" | StrategyId>("");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [lockPot, setLockPot] = useState(true);
  const [goalUsd, setGoalUsd] = useState(24560);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await api<{ strategies: Strategy[] }>("/v1/strategies");
      if (!cancelled) {
        setStrategies(res.strategies || []);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function create() {
    setErr(null);
    if (!token) {
      router.push("/onboarding/login");
      return;
    }
    const strategyId = risk || strategies[0]?.id || "conservative";
    const trimmedName = name.trim() || "My Savings Pot";
    const safeGoal = Number.isFinite(goalUsd) && goalUsd > 0 ? goalUsd : 24560;
    try {
      setBusy(true);
      const res = await api<{ pot: { id: string } }>("/v1/pots", {
        token,
        body: { name: trimmedName, strategyId, goalUsd: safeGoal, isLocked: lockPot },
      });
      router.push(`/pots/create/success?potId=${encodeURIComponent(res.pot.id)}`);
    } catch (e: any) {
      setErr(e?.message || "Failed to create pot");
    } finally {
      setBusy(false);
    }
  }

  if (isReady && !token) {
    return (
      <div className="page">
        <div className="section">
          <div className="card" style={{ padding: 16 }}>
            <div className="text-sm font-semibold">Sign in required</div>
            <p className="p">Please sign in to create a pot.</p>
            <div style={{ marginTop: 12 }}>
              <Link className="btn btn--primary" href="/onboarding/login">
                Go to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Create your pot</div>
        <div className="h2">Add some personalization to your pot</div>
        <div className="p">Set your pot name, emoji, theme, and risk level.</div>
      </div>

      <div className="form">
        <div className="label">Pot name *</div>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Joe Doe" />

        <div className="label">Pot emoji *</div>
        <select className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)}>
          <option value="">Select your pot emoji...</option>
          <option value="target">&#127919;</option>
          <option value="house">&#127968;</option>
          <option value="graduation">&#127891;</option>
          <option value="hospital">&#127973;</option>
        </select>

        <div className="label">Pot theme *</div>
        <select className="input" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="">Choose your pot theme colour...</option>
          <option value="blue">Blue</option>
          <option value="purple">Purple</option>
          <option value="green">Green</option>
          <option value="orange">Orange</option>
        </select>

        <div className="label">Strategy *</div>
        <div style={{ display: "grid", gap: 8 }}>
          {STRATEGY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRisk(opt.value)}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: risk === opt.value ? "2px solid var(--kb-blue)" : "2px solid rgba(17,24,39,.12)",
                background: risk === opt.value ? "rgba(10,87,232,.06)" : "transparent",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{opt.label}</div>
              <div className="p" style={{ margin: 0, fontSize: 13 }}>{opt.description}</div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{opt.allocation}</div>
            </button>
          ))}
        </div>

        <div className="label">Goal amount *</div>
        <input
          className="input"
          inputMode="decimal"
          value={goalUsd}
          onChange={(e) => setGoalUsd(Number(e.target.value.replace(/[^0-9.]/g, "")))}
          placeholder="24560"
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900 }}>Lock Pot?</div>
            <div className="p">
              Enabling the toggle button will mean locking the pot until maturity. Opening the pot before maturity will lead to a penalty.
            </div>
          </div>
          <button
            type="button"
            aria-pressed={lockPot}
            onClick={() => setLockPot((prev) => !prev)}
            style={{
              width: 52,
              height: 30,
              borderRadius: 999,
              border: 0,
              background: lockPot ? "var(--kb-blue)" : "rgba(17,24,39,.2)",
              position: "relative",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 4,
                left: lockPot ? "26px" : "4px",
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "#fff",
                transition: "left 150ms ease",
              }}
            />
          </button>
        </div>

        {err ? <div className="smalllinks" style={{ color: "#dc2626" }}>{err}</div> : null}

        <button className="btn btn--primary btn--full" onClick={create} disabled={busy}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M5 12h12M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {busy ? "Creating..." : "Next"}
          </span>
        </button>
      </div>
    </div>
  );
}
