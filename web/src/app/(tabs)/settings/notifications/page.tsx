"use client";

import Link from "next/link";

const Section = ({ title, body, hint }: { title: string; body: string; hint?: string }) => (
  <div className="rounded-2xl border border-black/10 bg-white p-4">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-xs text-slate-900">{body}</p>
      </div>
      <span className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px] font-semibold text-[var(--kb-blue)]">
        On
      </span>
    </div>
    {hint ? <p className="mt-2 text-[11px] text-slate-900">{hint}</p> : null}
  </div>
);

export default function SettingsNotificationsPage() {
  return (
    <div className="p-4">
      <Link href="/settings" className="text-xs font-semibold text-[var(--kb-blue)]">
        &larr; Settings
      </Link>
      <h1 className="mt-2 text-base font-semibold">Notifications</h1>
      <p className="mt-1 text-xs text-slate-900">Choose what you want to hear about.</p>

      <div className="mt-4 space-y-3">
        <Section
          title="Deposits"
          body="Alerts for confirmed deposits and withdrawals."
          hint="Instant alerts after confirmations on devnet."
        />
        <Section
          title="Market updates"
          body="Weekly performance snapshots and tips."
          hint="Delivered every Monday morning."
        />
        <Section title="Security" body="New device sign-ins and wallet changes." />
      </div>
    </div>
  );
}
