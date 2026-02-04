"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { useCurrentPot } from "@/lib/current-pot";
import { sendPreparedTransaction } from "@/lib/solana-tx";
import { DisclosuresCard, useDisclosureAcceptance } from "@/components/disclosures";

export default function DepositSolPage() {
  const { token } = useAuth();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { potId: currentPotId, setPotId } = useCurrentPot();

  const sp = useSearchParams();
  const router = useRouter();

  const potIdFromQuery = sp.get("potId") || "";
  const usdFromQuery = sp.get("usd") || "";

  // If the user selected a preset/slider amount, we keep it locked to prevent mismatch.
  const cameFromSlider = !!usdFromQuery;

  const [usd, setUsd] = useState<string>(usdFromQuery || "100");
  const minUsd = 5;
  const { accepted, setAccepted } = useDisclosureAcceptance();
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const usdNumber = useMemo(() => Number(usd), [usd]);

  // If user came from slider amount page, set the current pot selection.
  useEffect(() => {
    if (potIdFromQuery) setPotId(potIdFromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [potIdFromQuery]);

  async function send() {
    setStatus("");
    if (!token) throw new Error("Sign in first");
    if (!wallet.publicKey) throw new Error("Connect Phantom first");

    const potId = potIdFromQuery || currentPotId;
    if (!potId) throw new Error("Select a pot first");

    if (!Number.isFinite(usdNumber) || usdNumber < minUsd) {
      throw new Error(`Minimum deposit is $${minUsd}`);
    }
    if (!accepted) throw new Error("Please acknowledge the disclosures first.");

    setBusy(true);
    try {
      // 1) backend prepares a ready-to-sign tx (init PDA vault if needed + deposit)
      const prep = await api<{
        depositId: string;
        usd: number;
        solPriceUsd: number;
        sol: number;
        lamports: number;
        vaultPda: string;
        txBase64: string;
        txVersion?: "legacy" | "v0";
      }>("/v1/deposits/sol/prepare", {
        method: "POST",
        token,
        body: { potId, usd: usdNumber },
      });

      const sig = await sendPreparedTransaction({
        txBase64: prep.txBase64,
        txVersion: prep.txVersion,
        connection,
        wallet,
      });
      await connection.confirmTransaction(sig, "confirmed");

      // 2) tell backend the signature so it can verify + mark confirmed
      const confirmed = await api<{ ok: boolean; status: string; signature: string; usd: number }>(
        "/v1/deposits/sol/confirm",
        {
          method: "POST",
          token,
          body: { depositId: prep.depositId, signature: sig },
        }
      );

      setStatus(
        `Deposit confirmed ✅\n\nUSD: $${prep.usd.toFixed(2)}\nSOL/USD used: $${prep.solPriceUsd.toFixed(2)}\nLamports: ${prep.lamports}\nVault (PDA): ${prep.vaultPda}\n\nTx: ${sig}`
      );

      // optional: go back to pot details
      // router.push(`/pots/${potId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Deposit (Devnet Escrow)</div>
        <p className="p">
          You enter a <b>USD amount</b>. We convert it to SOL using a live SOL/USD quote, then generate a
          <b> per-pot escrow transaction</b>. You sign it in Phantom.
        </p>
        <p className="p">
          You will see an on-chain transaction in your wallet. Nothing moves until you approve it.
        </p>

        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <label className="p" style={{ fontWeight: 700 }}>
            USD amount (min ${minUsd})
          </label>

          {cameFromSlider ? (
            <div className="input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>${usdNumber.toFixed(0)}</span>
              <span className="label">Selected</span>
            </div>
          ) : (
            <input className="input" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />
          )}

          {!accepted ? <DisclosuresCard accepted={accepted} onToggle={setAccepted} compact /> : null}

          <button
            className="btn btn--primary"
            type="button"
            disabled={busy}
            onClick={() => send().catch((e) => setStatus(String(e?.message || e)))}
          >
            {busy ? "Opening Phantom…" : "Confirm in Phantom"}
          </button>

          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => router.push(`/pots/${potIdFromQuery || currentPotId || ""}`)}
          >
            Back to pot
          </button>
        </div>

        {status ? (
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }} className="card">
            {status}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

