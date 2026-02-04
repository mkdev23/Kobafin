"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function DepositCompletePage() {
  const searchParams = useSearchParams();
  const potId = searchParams?.get("potId") || "";
  const href = potId ? `/pots/${encodeURIComponent(potId)}` : "/home";
  return (
    <div className="page">
      <div className="center">
        <div className="h2">Deposit Complete</div>
        <div
          style={{
            width: 86,
            height: 86,
            borderRadius: 999,
            border: "10px solid #16a34a",
            display: "grid",
            placeItems: "center",
          }}
        >
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
            <path
              d="M20 6 9 17l-5-5"
              fill="none"
              stroke="#16a34a"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="p">Success</div>
        <Link href={href} className="btn btn--primary btn--full">
          Continue
        </Link>
      </div>
    </div>
  );
}

