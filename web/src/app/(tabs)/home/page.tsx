"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, LuloRates, Pot } from "@/lib/api";
import { colorForPot, heroGradient } from "@/lib/pot-colors";
import { apyFromRates, luloModeForStrategy } from "@/lib/lulo-rates";
import { useAuth } from "@/lib/auth-context";
import { YieldBreakdownCard } from "@/components/yield-breakdown";

function money(n: number) {
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

export default function HomePage() {
  const { token, isReady } = useAuth();
  const [pots, setPots] = useState<Pot[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalUsd, setTotalUsd] = useState<number>(0);
  const [rates, setRates] = useState<LuloRates | null>(null);
  const [deletingId, setDeletingId] = useState<string>("");
  const [deleteErr, setDeleteErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!token) return;
      try {
        setLoading(true);
        const res = await api<{ totalUsd: number; solUsd: number; pots: Pot[] }>("/v1/dashboard", { token });
        if (!cancelled) {
          setPots(res.pots || []);
          setTotalUsd(res.totalUsd || 0);
        }
      } catch {
        if (!cancelled) {
          setPots([]);
          setTotalUsd(0);
        }
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
            <p className="p">Connect your wallet and sign in to view your pots.</p>
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

  const activePot = pots[0];
  const activeApy = apyFromRates(rates, luloModeForStrategy(activePot?.strategyId));
  const activeApyDisplay = activeApy !== null ? activeApy.toFixed(2) : "--";
  const goal = activePot?.goalUsd ?? 24560;
  const activeColor = colorForPot(activePot, 0);
  const activeLocked = !!activePot?.isLocked;
  const withdrawalFee = activeLocked ? "15%" : "0%";
  const withdrawalStatus = activeLocked ? "Locked" : "Open";
  const activePrincipal =
    typeof (activePot as any)?.balanceUsd === "number" ? (activePot as any).balanceUsd : totalUsd;
  const yieldTitle = activePot?.name ? `Yield breakdown · ${activePot.name}` : "Yield breakdown";

  const potList: Pot[] = pots.length
    ? pots
    : [
        { id: "general", name: "General Savings Pot", strategyId: "conservative", userId: "", createdAt: "", isLocked: false },
        { id: "breakpoint", name: "Breakpoint Singapore 2024", strategyId: "conservative", userId: "", createdAt: "", isLocked: false },
      ];

  return (
    <div className="page">
      <div>
        <div className="hero" >
          <div className="hero__row">
            <div className="hero__meta">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="avatar">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z"
                      fill="white"
                      opacity=".92"
                    />
                  </svg>
                </div>
                <div>
                  <div className="hero__k">Total Amount</div>
                  <div className="hero__v">USD {totalUsd ? money(totalUsd) : "--"}</div>
                </div>
              </div>

              <div>
                <div className="hero__k">{activePot?.name || "General Savings Pot"}</div>
                <div style={{ height: 1, marginTop: 8, background: "rgba(255,255,255,.3)" }} />
              </div>
            </div>

            <div className="hero__right">
              <div className="kv">
                <div className="k">Interest earned</div>
                <div className="v">&mdash;</div>
              </div>
              <div className="kv">
                <div className="k">APY</div>
                <div className="v">{activeApy !== null ? `${activeApyDisplay}%` : "--"}</div>
              </div>
              <div className="kv">
                <div className="k">Goal</div>
                <div className="v">{money(goal)}</div>
              </div>

              <div style={{ marginTop: 6, textAlign: "right", opacity: 0.95 }}>
                <div style={{ fontSize: 10, opacity: 0.85 }}>Withdrawal</div>
                <div className="timer">
                  <div className="timer__item">
                    <div className="timer__num">{withdrawalFee}</div>
                    <div className="timer__lbl">fee</div>
                  </div>
                  <div className="timer__item">
                    <div className="timer__num">Anytime</div>
                    <div className="timer__lbl">withdraw</div>
                  </div>
                  <div className="timer__item">
                    <div className="timer__num">{withdrawalStatus}</div>
                    <div className="timer__lbl">status</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="section" style={{ paddingTop: 10 }}>
          <details className="yield-details card">
            <summary
              style={{
                listStyle: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <span>Yield breakdown</span>
              <span style={{ fontSize: 12, color: "rgba(17,24,39,0.6)" }}>Tap to view</span>
            </summary>
            <div style={{ marginTop: 12 }}>
              <YieldBreakdownCard
                title={yieldTitle}
                principalUsd={activePrincipal || 0}
                apy={activeApy}
                cashUsd={(activePot as any)?.cashUsd ?? null}
                investedUsd={(activePot as any)?.investedUsd ?? null}
                variant="plain"
              />
            </div>
          </details>
        </div>

        <div className="btnrow">
          <Link href={activePot ? `/deposit/amount?potId=${activePot.id}` : "/deposit/amount"} className="btn btn--primary btn--full">
            Deposit
          </Link>
          <Link href={activePot ? `/withdraw/sol?potId=${activePot.id}` : "/withdraw/sol"} className="btn btn--ghost btn--full">
            Withdraw
          </Link>
          <Link href={activePot ? `/pots/${activePot.id}` : "/savings"} className="btn btn--ghost btn--full">
            Pot Details
          </Link>
        </div>

        <div className="subhead">
          <div>My pots</div>
          <Link className="link" href="/pots/create">
            + Add pot
          </Link>
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

        <div className="learn">
          <div>Recommended learning</div>
          <div className="p" style={{ color: "rgba(255,255,255,.85)" }}>
            Based on the pot you chose, please go through this recommended pot module to learn more about how you can improve on your finances
          </div>
          <div className="learn__row">
            <div className="progress">
              <div className="progress__badge">0%</div>
              <div>0/10</div>
            </div>
            <Link href="/resources" className="btn btn--ghost">
              Start now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
