"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, Deposit, LuloRates, Pot } from "@/lib/api";
import { colorForPot, heroGradient } from "@/lib/pot-colors";
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

export default function PotDetailPage() {
  const { token, isReady } = useAuth();
  const params = useParams<{ id: string }>();
  const potId = params?.id;
  const router = useRouter();

  const [pot, setPot] = useState<Pot | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [rates, setRates] = useState<LuloRates | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setErr("");
      if (!token || !potId || typeof potId !== "string") return;
      try {
        setLoading(true);
        const [pRes, dRes] = await Promise.all([
          api<{ pot: Pot }>(`/v1/pots/${encodeURIComponent(potId)}`, { token }),
          api<{ deposits: Deposit[]; totalUsdc: number }>(`/v1/pots/${encodeURIComponent(potId)}/deposits`, { token }),
        ]);
        if (cancelled) return;
        setPot(pRes.pot);
        setDeposits(dRes.deposits || []);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token, potId]);

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

  const total = useMemo(() => {
    return deposits.reduce((sum, d) => sum + (d.netUsdc || 0), 0);
  }, [deposits]);

  async function deletePot() {
    if (!token || !potId || typeof potId !== "string") return;
    const confirmed = window.confirm(
      "Delete this pot? This only works if the pot balance is under $0.01."
    );
    if (!confirmed) return;
    setDeleteErr("");
    setDeleteBusy(true);
    try {
      await api(`/v1/pots/${encodeURIComponent(potId)}`, { method: "DELETE", token });
      router.push("/home");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("pot_not_empty")) {
        setDeleteErr("Pot is not empty. Balance must be under $0.01 to delete.");
      } else {
        setDeleteErr(msg);
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  if (isReady && !token) {
    return (
      <div className="page">
        <div className="section">
          <div className="card" style={{ padding: 16 }}>
            <div className="text-sm font-semibold">Sign in required</div>
            <p className="p">Please sign in to view this pot.</p>
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

  if (!potId || typeof potId !== "string") {
    return (
      <div className="page">
        <div className="section">
          <div className="card" style={{ padding: 16 }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="page">
        <div className="section">
          <div className="card" style={{ padding: 16 }}>
            <div className="text-sm font-semibold">Couldn't load pot</div>
            <p className="p">{err}</p>
          </div>
        </div>
      </div>
    );
  }

  const potColor = colorForPot(pot || undefined, 0);
  const apy = apyFromRates(rates, luloModeForStrategy(pot?.strategyId));
  const apyDisplay = apy !== null ? `${apy.toFixed(2)}%` : "--";

  return (
    <div className="page">
      <div className="hero" style={{ borderRadius: "0 0 18px 18px", background: heroGradient(potColor) }}>
        <div className="h2">{pot?.name || (loading ? "Loading..." : "\u2014")}</div>
        <div className="p" style={{ color: "rgba(255,255,255,.85)" }}>
          Total Amount USD {money(total)} <span>&middot;</span> APY {apyDisplay}
        </div>
      </div>

      <div className="section" style={{ paddingTop: 12 }}>
        <YieldBreakdownCard
          title="Yield breakdown"
          principalUsd={total}
          apy={apy}
          cashUsd={(pot as any)?.cashUsd ?? null}
          investedUsd={(pot as any)?.investedUsd ?? null}
        />
      </div>

      <div className="section">
        <div className="h2">Transactions</div>

        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {deposits.length ? (
              deposits.slice(0, 6).map((d) => (
                <tr key={d.id}>
                  <td>{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td>{d.netUsdc >= 0 ? "Deposit" : "Withdrawal"}</td>
                  <td style={{ textAlign: "right" }}>{d.netUsdc >= 0 ? "+" : ""}{money(d.netUsdc)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>No transactions yet.</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="p">Use Deposit to add funds via card, mobile money, or cash.</div>
        <Link href={`/deposit/amount?potId=${encodeURIComponent(potId)}`} className="btn btn--primary btn--full">
          Deposit
        </Link>
        <Link
          href={`/withdraw/sol?potId=${encodeURIComponent(potId)}`}
          className="btn btn--ghost btn--full"
          style={{ marginTop: 10 }}
        >
          Withdraw
        </Link>
        <button
          type="button"
          className="btn btn--ghost btn--full"
          style={{ marginTop: 10 }}
          onClick={deletePot}
          disabled={deleteBusy}
        >
          {deleteBusy ? "Deleting..." : "Delete pot"}
        </button>
        {deleteErr ? (
          <div className="p" style={{ color: "#dc2626", marginTop: 8 }}>
            {deleteErr}
          </div>
        ) : null}
      </div>
    </div>
  );
}
