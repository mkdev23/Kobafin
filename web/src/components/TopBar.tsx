"use client";

import React, { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

const TAB_ROUTES = new Set(["/home", "/savings", "/resources", "/more"]);

function titleForPath(pathname: string) {
  if (pathname.startsWith("/onboarding/signup")) return "Sign up";
  if (pathname.startsWith("/onboarding/form")) return "Sign up";
  if (pathname.startsWith("/onboarding/verify")) return "OTP message";
  if (pathname.startsWith("/onboarding/login")) return "Sign in";
  if (pathname.startsWith("/onboarding/welcome")) return "KobaFin";
  if (pathname.startsWith("/home")) return "KobaFin";
  if (pathname.startsWith("/savings")) return "Savings";
  if (pathname.startsWith("/resources")) return "Resources";
  if (pathname.startsWith("/more")) return "More";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/pots/create")) return "Create your pot";
  if (pathname.startsWith("/pots/")) return "Pot Details";
  if (pathname.startsWith("/deposit/amount")) return "Homepage";
  if (pathname.startsWith("/deposit/duration")) return "Deposit Amount";
  if (pathname.startsWith("/deposit/payment")) return "Deposit Amount";
  if (pathname.startsWith("/deposit/complete")) return "Deposit Complete";
  return "KobaFin";
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const title = useMemo(() => titleForPath(pathname), [pathname]);
  const isTab = TAB_ROUTES.has(pathname);
  const hideBack = isTab || pathname === "/onboarding/welcome";

  return (
    <header className="topbar">
      <button
        className="iconbtn"
        aria-label="Back"
        style={{ visibility: hideBack ? "hidden" : "visible" }}
        onClick={() => router.back()}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M15 18l-6-6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="topbar__title">{title}</div>

      <button className="iconbtn" aria-label="Menu" onClick={() => router.push("/settings")}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  );
}
