"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Method = "mobile" | "cash" | "card" | "sol";

export default function DepositPaymentPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();

  const amount = Number(sp.get("amount") || 100);
  const method = (sp.get("method") as Method) || "mobile";
  const potId = sp.get("potId") || "";

  const [selected, setSelected] = useState<Method>(method);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const modalTitle = useMemo(() => {
    if (selected === "card") return "Card deposit";
    if (selected === "mobile") return "Mobile money deposit";
    if (selected === "sol") return "SOL deposit";
    return "Cash deposit";
  }, [selected]);

  async function completeDeposit() {
    if (!token || !potId) {
      router.push("/onboarding/login");
      return;
    }
    try {
      setBusy(true);
      await api("/v1/deposits/mock", { token, body: { potId, netUsdc: amount } });
      router.push(`/deposit/complete?amount=${amount}&method=${selected}&potId=${encodeURIComponent(potId)}`);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div className="page">
      <div className="section" style={{ textAlign: "center" }}>
        <div className="h2">Choose your payment method</div>
        <div className="p">Pick a method to complete your deposit.</div>
      </div>

      <div className="form">
        <div className="label">Payment method *</div>
        <div className="chips">
          <button
            type="button"
            className={"chip " + (selected === "mobile" ? "is-active" : "")}
            onClick={() => setSelected("mobile")}
          >
            <span style={{ opacity: 0.7 }}>&#128241;</span> Mobile money
          </button>
          <button
            type="button"
            className={"chip " + (selected === "cash" ? "is-active" : "")}
            onClick={() => setSelected("cash")}
          >
            <span style={{ opacity: 0.7 }}>&#128181;</span> Cash
          </button>
          <button
            type="button"
            className={"chip " + (selected === "card" ? "is-active" : "")}
            onClick={() => setSelected("card")}
          >
            <span style={{ opacity: 0.7 }}>&#128179;</span> Card deposit
          </button>
          <button
            type="button"
            className={"chip " + (selected === "sol" ? "is-active" : "")}
            onClick={() => setSelected("sol")}
          >
            <span style={{ opacity: 0.7 }}>&#128184;</span> SOL (wallet)
          </button>
        </div>

        <button
          className="btn btn--primary btn--full"
          onClick={() => {
            if (selected === "sol") {
              const qs = new URLSearchParams();
              qs.set("usd", String(amount));
              if (potId) qs.set("potId", potId);
              router.push(`/deposit/sol?${qs.toString()}`);
              return;
            }
            setOpen(true);
          }}
        >
          Continue
        </button>
      </div>

      <div className={`modal ${open ? "is-open" : ""}`}>
        <div className="modal__backdrop" onClick={() => setOpen(false)} />
        <div className="modal__panel" role="dialog" aria-modal="true">
          <div className="modal__header">
            <div className="modal__title">{modalTitle}</div>
            <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Close">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="modal__body">
            {selected === "card" ? (
              <>
                <div className="label">CardNumber *</div>
                <input className="input" placeholder="0000 0000 0000 0000" inputMode="numeric" />
                <div className="label">Expiry date *</div>
                <input className="input" placeholder="01/02/28" />
                <div className="label">CVV *</div>
                <input className="input" placeholder="098" inputMode="numeric" />
              </>
            ) : null}

            {selected === "mobile" ? (
              <>
                <div className="p">Mobile money deposit</div>
                <div className="label">Phone number</div>
                <input className="input" placeholder="+232 78 0000000" />
                <div className="label">Deposit amount</div>
                <input className="input" value={`$${amount}`} readOnly />
              </>
            ) : null}

            {selected === "cash" ? (
              <>
                <div className="p">Cash deposit</div>
                <div className="p">Bring cash to an agent or partner location. (Prototype)</div>
              </>
            ) : null}

            <button className="btn btn--primary btn--full" disabled={busy} onClick={completeDeposit}>
              {busy ? "Processing..." : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

