"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, LuloRates, Pot } from "@/lib/api";
import { colorForPot } from "@/lib/pot-colors";
import { useAuth } from "@/lib/auth-context";
import { apyFromRates, luloModeForStrategy } from "@/lib/lulo-rates";
import { YieldBreakdownCard } from "@/components/yield-breakdown";

function money(n: number) {
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

export default function SavingsPage() {
  const { token, isReady } = useAuth();
  const [pots, setPots] = useState<Pot[]>([]);
  const [loading, setLoading] = useState(false);
  const [rates, setRates] = useState<LuloRates | null>(null);
  const [deletingId, setDeletingId] = useState<string>("");
  const [deleteErr, setDeleteErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      try {
        setLoading(true);
        const res = await api<{ pots: Pot[] }>("/v1/dashboard", { token });
        if (!cancelled) setPots(res.pots || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleDelete(potId: string) {
    if (!token) return;
    const confirmed = window.confirm("Delete this pot? This only works if the pot balance is under $0.01.");
    if (!confirmed) return;
    setDeleteErr("");
    setDeletingId(potId);
    try {
      await api(`/v1/pots/${encodeURIComponent(potId)}`, { method: "DELETE", token });
      setPots((prev) => prev.filter((p) => p.id !== potId));
    } catch (e: any) {
      const msg = String(e?.message || e);
      setDeleteErr(msg.includes("pot_not_empty") ? "Pot is not empty (must be under $0.01)." : msg);
    } finally {
      setDeletingId("");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadRates() {
      try {
        const res = await api<{ rates: LuloRates }>("/v1/lulo/rates");
        if (!cancelled) setRates(res.rates || null);
      } catch {
        if (!cancelled) setRates(null);
      }
    }
    loadRates();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isReady && !token) {
    return (
      <div className="page">
        <div className="section">
          <div className="card" style={{ padding: 16 }}>
            <div className="text-sm font-semibold">Sign in required</div>
            <p className="p">Please sign in to view your pots.</p>
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

  const potList: Pot[] = pots.length
    ? pots
    : [{ id: "general", name: "General Savings Pot", strategyId: "conservative", userId: "", createdAt: "", isLocked: false }];

  const activePot = potList[0];
  const activeApy = apyFromRates(rates, luloModeForStrategy(activePot?.strategyId));
  const principal =
    typeof (activePot as any)?.balanceUsd === "number" ? (activePot as any).balanceUsd : 0;

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Savings</div>
        <div className="p">My pots</div>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <YieldBreakdownCard
          title={activePot?.name ? `Yield breakdown · ${activePot.name}` : "Yield breakdown"}
          principalUsd={principal}
          apy={activeApy}
          cashUsd={(activePot as any)?.cashUsd ?? null}
          investedUsd={(activePot as any)?.investedUsd ?? null}
        />
      </div>

      <div className="potlist">
        {potList.map((p, idx) => (
          <div key={p.id} className={`pot pot--${colorForPot(p as any, idx)}`}>
            <Link href={`/pots/${p.id}`} className="pot__link">
              <div className="pot__left">
                <div className="pot__icon">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      d="M12 2l4 7h-8l4-7Zm0 20c-4.4 0-8-3.6-8-8 0-1.5.4-2.9 1.1-4.1h13.8C19.6 11.1 20 12.5 20 14c0 4.4-3.6 8-8 8Z"
                      fill="white"
                      opacity=".92"
                    />
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="pot__title">{p.name}</div>
                  <div className="pot__meta">
                    Total Amount USD {money((p as any).balanceUsd ?? 0)} <span>&middot;</span>{" "}
                    Withdrawal {p.isLocked ? "Anytime (15% fee)" : "Anytime"}
                  </div>
                </div>
              </div>
              <div className="pot__right">
                <div className="pot__pill">
                  APY - {(() => {
                    const apy = apyFromRates(rates, luloModeForStrategy((p as any).strategyId));
                    return apy !== null ? `${apy.toFixed(2)}%` : "--";
                  })()}
                </div>
                <div>
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path
                      d="M9 18l6-6-6-6"
                      fill="none"
                      stroke="rgba(255,255,255,.9)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </Link>
            {token && p.userId ? (
              <button
                type="button"
                className="pot__delete"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleDelete(p.id);
                }}
                disabled={deletingId === p.id}
              >
                {deletingId === p.id ? "Deleting..." : "Delete"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {deleteErr ? (
        <div className="section" style={{ paddingTop: 0 }}>
          <div className="p" style={{ color: "#dc2626" }}>{deleteErr}</div>
        </div>
      ) : null}

      <div className="section" style={{ paddingTop: 0 }}>
        <div className="p">Recommended pots</div>
      </div>

      <div className="potlist">
        {[
          { id: "health", name: "Healthcare", color: "purple" },
          { id: "school", name: "School Fees", color: "green" },
        ].map((p) => (
          <div key={p.id} className={`pot pot--${p.color}`}>
            <div className="pot__left">
              <div className="pot__icon">
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path
                    d="M12 2l4 7h-8l4-7Zm0 20c-4.4 0-8-3.6-8-8 0-1.5.4-2.9 1.1-4.1h13.8C19.6 11.1 20 12.5 20 14c0 4.4-3.6 8-8 8Z"
                    fill="white"
                    opacity=".92"
                  />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="pot__title">{p.name}</div>
                <div className="pot__meta">
                  Total Amount USD {money(0)} <span>&middot;</span> Withdrawal 0 days
                </div>
              </div>
            </div>
            <div className="pot__right">
              <div className="pot__pill">APY - --</div>
              <div>
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path
                    d="M9 18l6-6-6-6"
                    fill="none"
                    stroke="rgba(255,255,255,.9)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
