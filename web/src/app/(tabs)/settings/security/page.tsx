"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const Section = ({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) => (
  <div className="rounded-2xl border border-black/10 bg-white p-4">
    <div className="text-sm font-semibold">{title}</div>
    <p className="mt-1 text-xs text-slate-900">{body}</p>
    {children ? <div className="mt-3">{children}</div> : null}
  </div>
);

export default function SettingsSecurityPage() {
  const { token, user, refreshMe } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lockedUntil = useMemo(() => {
    if (!user?.recoveryLockedUntil) return null;
    const d = new Date(user.recoveryLockedUntil);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [user?.recoveryLockedUntil]);

  const isLocked = lockedUntil ? lockedUntil.getTime() > Date.now() : false;

  useEffect(() => {
    if (token) refreshMe();
  }, [token, refreshMe]);

  async function toggleRecovery(next: boolean) {
    if (!token) return;
    setErr(null);
    try {
      setBusy(true);
      await api("/v1/me/recovery", {
        method: "POST",
        token,
        body: { enabled: next },
      });
      await refreshMe();
    } catch (e: any) {
      setErr(e?.message || "Failed to update recovery mode");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4">
      <Link href="/settings" className="text-xs font-semibold text-[var(--kb-blue)]">
        &larr; Settings
      </Link>
      <h1 className="mt-2 text-base font-semibold">Security</h1>
      <p className="mt-1 text-xs text-slate-900">Control sign-in and device security.</p>

      <div className="mt-4 space-y-3">
        <Section title="Session" body="Sign out of all devices in Phase 2." />
        <Section title="Two-factor" body="Add an extra layer of protection in Phase 2." />
        <Section
          title="Recovery mode"
          body="Enable recovery mode to simulate post-recovery lockout. Withdrawals will be blocked for 24–72 hours."
        >
          <div className="flex items-center justify-between rounded-xl border border-black/10 px-3 py-2 text-xs">
            <div>
              <div className="font-semibold">Recovery mode</div>
              <div className="text-slate-600">
                {user?.recoveryMode ? "Enabled" : "Disabled"}
                {isLocked && lockedUntil ? ` · Locked until ${lockedUntil.toLocaleString()}` : ""}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => toggleRecovery(!user?.recoveryMode)}
              className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60"
            >
              {user?.recoveryMode ? "Disable" : "Enable"}
            </button>
          </div>
          {isLocked ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Withdrawals are temporarily locked for safety after recovery. This lock is configurable.
            </div>
          ) : null}
          {err ? <div className="mt-2 text-xs font-semibold text-red-600">{err}</div> : null}
        </Section>
      </div>
    </div>
  );
}
