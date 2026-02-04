"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

type Tab = { href: string; label: string; icon: React.ReactNode };

function Icon({ name }: { name: "home" | "savings" | "resources" | "more" }) {
  const cls = "tab__icon";
  switch (name) {
    case "home":
      return (
        <svg className={cls} width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V11z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "savings":
      return (
        <svg className={cls} width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 7h16v12H4z" stroke="currentColor" strokeWidth="2" />
          <path d="M7 7V5h10v2" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "resources":
      return (
        <svg className={cls} width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 4h16v16H4z" stroke="currentColor" strokeWidth="2" />
          <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "more":
      return (
        <svg className={cls} width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
          <path d="M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
          <path d="M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" fill="currentColor" />
        </svg>
      );
  }
}

export function BottomNav() {
  const pathname = usePathname();
  const tabs: Tab[] = [
    { href: "/home", label: "Home", icon: <Icon name="home" /> },
    { href: "/savings", label: "Savings", icon: <Icon name="savings" /> },
    { href: "/resources", label: "Resources", icon: <Icon name="resources" /> },
    { href: "/more", label: "More", icon: <Icon name="more" /> },
  ];

  return (
    <nav className="tabbar">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={"tab " + (active ? "is-active" : "")}
          >
            {t.icon}
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
