import React from "react";

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {action}
    </div>
  );
}

export function PrimaryButton({
  children,
  href,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const cls =
    "w-full rounded-xl bg-[var(--kb-blue)] px-4 py-3 text-center text-sm font-semibold text-white shadow-sm disabled:opacity-50";
  if (href) {
    const Link = require("next/link").default;
    return (
      <Link href={href} className={cls} aria-disabled={disabled}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, href }: { children: React.ReactNode; href: string }) {
  const Link = require("next/link").default;
  return (
    <Link
      href={href}
      className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-900"
    >
      {children}
    </Link>
  );
}

export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold text-white">
      {children}
    </span>
  );
}
