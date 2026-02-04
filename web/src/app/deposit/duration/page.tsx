"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, LuloRates, Pot } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { apyFromRates, luloModeForStrategy } from "@/lib/lulo-rates";

export default function DepositDurationPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
  const amount = Number(sp.get("amount") || 100);
  const method = sp.get("method") || "mobile";
  const potId = sp.get("potId") || "";

  const [months, setMonths] = useState(6);
  const [pot, setPot] = useState<Pot | null>(null);
  const [rates, setRates] = useState<LuloRates | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadPot() {
      if (!potId || !token) return;
      try {
        const res = await api<{ pot: Pot }>(`/v1/pots/${encodeURIComponent(potId)}`, { token });
        if (!cancelled) setPot(res.pot);
      } catch {
        if (!cancelled) setPot(null);
      }
    }
    loadPot();
    return () => {
      cancelled = true;
    };
  }, [potId, token]);

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

  const expectedReturns = useMemo(() => {
    const apy = apyFromRates(rates, luloModeForStrategy(pot?.strategyId));
    if (apy === null || !Number.isFinite(amount) || amount <= 0) return null;
    const monthlyRate = apy / 100 / 12;
    const est = amount * monthlyRate * months;
    return est;
  }, [rates, pot?.strategyId, amount, months]);

  function goNext() {
    const qs = new URLSearchParams();
    qs.set("amount", String(amount));
    qs.set("method", method);
    qs.set("months", String(months));
    if (potId) qs.set("potId", potId);
    router.push(`/deposit/payment?${qs.toString()}`);
  }

  return (
    <div className="page">
      <div className="section" style={{ textAlign: "center" }}>
        <div className="h2">Set up your savings duration</div>
        <div className="p">Choose how long to lock the pot for better returns (prototype).</div>
      </div>

      <div className="form">
        <div className="label">Expected returns *</div>
        <div style={{ fontWeight: 900 }}>
          {expectedReturns === null ? "--" : `$ ${expectedReturns.toFixed(2)}`}
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8, marginTop: 10 }}>
          <div style={{ fontSize: 54, fontWeight: 1000, color: "var(--kb-blue)" }}>{months}</div>
          <div style={{ color: "rgba(17,24,39,.55)", fontWeight: 800 }}>months</div>
        </div>

        <input
          type="range"
          className="slider"
          min={1}
          max={24}
          step={1}
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
        />

        <button className="btn btn--primary btn--full" onClick={goNext}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                d="M5 12h12M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Next
          </span>
        </button>
      </div>
    </div>
  );
}
