"use client";

import Link from "next/link";

const Section = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-2xl border border-black/10 bg-white p-4">
    <div className="text-sm font-semibold">{title}</div>
    <p className="mt-1 text-xs text-slate-900">{body}</p>
  </div>
);

export default function SettingsAboutPage() {
  return (
    <div className="p-4">
      <Link href="/settings" className="text-xs font-semibold text-[var(--kb-blue)]">
        &larr; Settings
      </Link>
      <h1 className="mt-2 text-base font-semibold">About</h1>
      <p className="mt-1 text-xs text-slate-900">KobaFin devnet PoC build.</p>

      <div className="mt-4 space-y-3">
        <Section title="Network" body="Solana devnet" />
        <Section title="Version" body="Phase 1 stable build" />
        <Section
          title="Positioning"
          body="KobaFin is a self-custodied savings platform with optional crypto exposure. We do not provide investment advice."
        />
        <Section
          title="Required disclosures"
          body="Crypto assets are volatile. Only USDC earns yield in V1. Yield is variable and not guaranteed. Portfolio value may fluctuate. No auto-rebalancing in V1."
        />
        <Section
          title="V1 exclusions"
          body="No auto-rebalancing, no asset switching inside pools, no yield on BTC/ETH/SOL, no LPs or staking, no leverage, no shorting, no price predictions."
        />
        <Section title="Support" body="Contact the team for enterprise pilots." />
      </div>
    </div>
  );
}
