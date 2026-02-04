"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

const PAYMENT_METHODS = ["mobile", "cash", "card", "sol"] as const;

export default function DepositAmountPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const potId = sp.get("potId") || "";

  const [amount, setAmount] = useState(100);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("mobile");

  const chips = useMemo(() => [50, 100, 200, 500, 1000], []);

  function goNext() {
    const qs = new URLSearchParams();
    qs.set("amount", String(amount));
    qs.set("method", method);
    if (potId) qs.set("potId", potId);
    router.push(`/deposit/duration?${qs.toString()}`);
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Deposit into your pot</div>
        <div className="p">Set an amount and choose how you want to deposit.</div>
      </div>

      <div className="form">
        <div className="label">Deposit amount *</div>
        <input
          className="input"
          value={`$${amount}`}
          onChange={(e) => {
            const v = Number(String(e.target.value).replace(/[^0-9.]/g, ""));
            if (!Number.isNaN(v)) setAmount(v);
          }}
        />

        <div className="chips">
          {chips.map((v) => (
            <button
              key={v}
              type="button"
              className={"chip " + (amount === v ? "is-active" : "")}
              onClick={() => setAmount(v)}
            >
              ${v}
            </button>
          ))}
        </div>

        <input
          type="range"
          className="slider"
          min={0}
          max={1000}
          step={10}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />

        <div className="label">Payment method *</div>
        <div className="chips">
          <button
            type="button"
            className={"chip " + (method === "mobile" ? "is-active" : "")}
            onClick={() => setMethod("mobile")}
          >
            <span style={{ opacity: 0.7 }}>&#128241;</span> Mobile money
          </button>
          <button
            type="button"
            className={"chip " + (method === "cash" ? "is-active" : "")}
            onClick={() => setMethod("cash")}
          >
            <span style={{ opacity: 0.7 }}>&#128179;</span> Cash
          </button>
          <button
            type="button"
            className={"chip " + (method === "card" ? "is-active" : "")}
            onClick={() => setMethod("card")}
          >
            <span style={{ opacity: 0.7 }}>&#128179;</span> Card
          </button>
          <button
            type="button"
            className={"chip " + (method === "sol" ? "is-active" : "")}
            onClick={() => setMethod("sol")}
          >
            <span style={{ opacity: 0.7 }}>&#128184;</span> SOL (wallet)
          </button>
        </div>

        <button className="btn btn--primary btn--full" onClick={goNext}>
          Next
        </button>
      </div>
    </div>
  );
}
