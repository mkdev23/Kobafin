"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function CardDepositPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isReady } = useAuth();
  const amount = Number(searchParams?.get("amount") || 100);
  const potId = searchParams?.get("potId") || "";
  const minUsd = 5;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!token) {
      router.push("/onboarding/login");
      return;
    }
    if (!potId) {
      setErr("Missing potId. Start from a pot and tap Deposit.");
      return;
    }
    if (!Number.isFinite(amount) || amount < minUsd) {
      setErr(`Minimum deposit is $${minUsd}.`);
      return;
    }
    try {
      setBusy(true);
      const res = await api<{ depositId: string }>("/v1/deposits/mock", {
        token,
        body: { potId, netUsdc: amount },
      });
      router.push(`/deposit/complete?amount=${amount}&method=card&potId=${encodeURIComponent(potId)}&depositId=${encodeURIComponent(res.depositId)}`);
    } catch (e: any) {
      setErr(e?.message || "Deposit failed");
    } finally {
      setBusy(false);
    }
  }

  if (isReady && !token) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4">
          <div className="text-sm font-semibold">Sign in required</div>
          <p className="mt-1 text-xs text-slate-900">Please sign in to deposit.</p>
          <div className="mt-3">
            <Link
              href="/onboarding/login"
              className="inline-flex items-center rounded-xl bg-[var(--kb-blue)] px-3 py-2 text-xs font-semibold text-white"
            >
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="rounded-2xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Card deposit</div>
        <p className="mt-1 text-xs text-slate-900">PoC: this simulates settlement in the backend.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-900">Card number</label>
            <input
              className="mt-1 w-full rounded-xl border border-black/10 px-4 py-3 text-sm"
              placeholder="0000 0000 0000 0000"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-900">Expiry</label>
              <input
                className="mt-1 w-full rounded-xl border border-black/10 px-4 py-3 text-sm"
                placeholder="MM/YY"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-900">CVV</label>
              <input
                className="mt-1 w-full rounded-xl border border-black/10 px-4 py-3 text-sm"
                placeholder="000"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-900">
          Deposit amount: <span className="font-semibold">${amount}</span>
        </div>

        {err ? <p className="mt-3 text-xs font-semibold text-red-600">{err}</p> : null}

        <div className="mt-5">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="block w-full rounded-xl bg-[var(--kb-blue)] px-4 py-3 text-center text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Processing..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
