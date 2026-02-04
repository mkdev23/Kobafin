"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

const Section = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-2xl border border-black/10 bg-white p-4">
    <div className="text-sm font-semibold">{title}</div>
    <p className="mt-1 text-xs text-slate-900">{body}</p>
  </div>
);

export default function SettingsProfilePage() {
  const { user } = useAuth();
  return (
    <div className="p-4">
      <Link href="/settings" className="text-xs font-semibold text-[var(--kb-blue)]">
        &larr; Settings
      </Link>
      <h1 className="mt-2 text-base font-semibold">Profile</h1>
      <p className="mt-1 text-xs text-slate-900">Manage your personal details.</p>

      <div className="mt-4 space-y-3">
        <Section title="Name" body="Profile editing lands in Phase 2." />
        <Section title="Email" body="Add recovery email in Phase 2." />
        <Section
          title="Wallet"
          body={
            user?.walletAddress
              ? `${user.walletAddress} \u00b7 Your wallet address is the primary identifier.`
              : "Your wallet address is the primary identifier."
          }
        />
      </div>
    </div>
  );
}
