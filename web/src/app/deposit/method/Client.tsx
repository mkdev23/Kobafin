"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function DepositMethodPage() {
  const sp = useSearchParams();
  const amount = Number(sp.get("amount") || "100");
  const potId = sp.get("potId") || "";

  const Card = ({ title, href, subtitle }: { title: string; href: string; subtitle: string }) => (
    <Link
      href={href}
      className="block rounded-2xl border border-black/10 bg-white p-4 hover:border-black/20"
    >
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-xs text-slate-900">{subtitle}</div>
    </Link>
  );

  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <div className="text-sm font-semibold text-slate-900">Choose a deposit method</div>
        <p className="mt-1 text-xs text-slate-900">Amount: ${amount}</p>
      </div>

      <div className="mt-4 space-y-3">
        <Card
          title="Phantom (SOL escrow)"
          subtitle="Devnet: converts USD -> SOL and deposits into your per-pot vault"
          href={`/deposit/sol?usd=${amount}${potId ? `&potId=${encodeURIComponent(potId)}` : ""}&autostart=1`}
        />
        <Card
          title="Mobile money"
          subtitle="POC placeholder"
          href={`/deposit/mobile?amount=${amount}${potId ? `&potId=${encodeURIComponent(potId)}` : ""}`}
        />
        <Card
          title="Card"
          subtitle="POC placeholder"
          href={`/deposit/card?amount=${amount}${potId ? `&potId=${encodeURIComponent(potId)}` : ""}`}
        />
      </div>
    </div>
  );
}

