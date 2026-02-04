"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { useCurrentPot } from "@/lib/current-pot";

const Row = ({ title, href, detail }: { title: string; href: string; detail: string }) => (
  <Link
    href={href}
    className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-4"
  >
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs text-slate-900">{detail}</div>
    </div>
    <span className="text-sm text-slate-900"></span>
  </Link>
);

export default function SettingsPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { setPotId } = useCurrentPot();

  return (
    <div className="p-4">
      <h1 className="text-base font-semibold">Settings</h1>
      <p className="mt-1 text-xs text-slate-900">Manage your account and app preferences.</p>

      <div className="mt-4 space-y-3">
        <Row title="Profile" href="/settings/profile" detail="Identity, wallet, and personal info" />
        <Row title="Security" href="/settings/security" detail="Sessions, recovery, and 2FA" />
        <Row title="Notifications" href="/settings/notifications" detail="Deposit alerts and updates" />
        <Row title="About" href="/settings/about" detail="Version and network" />
      </div>

      <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Developer</div>
        <p className="mt-1 text-xs text-slate-900">Wallet sign-in + API auth lives under dev tools.</p>
        <div className="mt-3">
          <Link
            href="/dev/siws"
            className="inline-flex rounded-xl bg-[var(--kb-blue)] px-3 py-2 text-xs font-semibold text-white"
          >
            Open SIWS
          </Link>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-red-200 bg-white p-4">
        <div className="text-sm font-semibold text-red-700">Account</div>
        <p className="mt-1 text-xs text-slate-900">Sign out clears your API session token on this device.</p>

        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white"
          onClick={() => {
            logout();
            setPotId("");
            router.push("/onboarding/login");
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
