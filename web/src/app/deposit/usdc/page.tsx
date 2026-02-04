"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCurrentPot } from "@/lib/current-pot";
import { sendPreparedTransaction } from "@/lib/solana-tx";
import { DisclosuresCard, useDisclosureAcceptance } from "@/components/disclosures";

export default function DepositUsdcPage() {
  const { token, user } = useAuth();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { potId: currentPotId, setPotId } = useCurrentPot();
  const sp = useSearchParams();
  const router = useRouter();

  const potIdFromQuery = sp.get("potId") || "";
  const [usd, setUsd] = useState("100");
  const minUsd = 5;
  const { accepted, setAccepted } = useDisclosureAcceptance();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const usdNumber = useMemo(() => Number(usd), [usd]);

  useEffect(() => {
    if (potIdFromQuery) setPotId(potIdFromQuery);
  }, [potIdFromQuery, setPotId]);

  async function send() {
    setStatus("");
    if (!token) throw new Error("Sign in first");
    if (!wallet.publicKey) throw new Error("Connect Phantom");
    if (user?.walletAddress && wallet.publicKey.toBase58() !== user.walletAddress) {
      throw new Error(`Wallet mismatch. Please connect ${user.walletAddress}.`);
    }
    const potId = potIdFromQuery || currentPotId;
    if (!potId) throw new Error("Select a pot first");
    if (!Number.isFinite(usdNumber) || usdNumber < minUsd) {
      throw new Error(`Minimum deposit is $${minUsd}`);
    }
    if (!accepted) throw new Error("Please acknowledge the disclosures first.");

    setBusy(true);
    try {
      const prep = await api<{
        depositId: string;
        usd: number;
        usdcBaseUnits: number;
        vaultPda: string;
        vaultUsdc: string;
        txBase64: string;
        txVersion?: "legacy" | "v0";
      }>("/v1/deposits/usdc/prepare", {
        method: "POST",
        token,
        body: { potId, usd: usdNumber },
      });

      const sig = await sendPreparedTransaction({
        txBase64: prep.txBase64,
        txVersion: prep.txVersion,
        connection,
        wallet,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(sig, "confirmed");

      await api<{ ok: boolean; status: string }>("/v1/deposits/usdc/confirm", {
        method: "POST",
        token,
        body: { depositId: prep.depositId, signature: sig },
      });

      setStatus(
        `USDC deposit confirmed.\nUSD: $${prep.usd.toFixed(2)}\nUSDC (base units): ${prep.usdcBaseUnits}\nVault: ${prep.vaultPda}\nTx: ${sig}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Fund vault (USDC)</div>
        <p className="p">Deposit USDC into your vault so it can be allocated to Lulo.</p>
        <p className="p">
          You will sign an on-chain transaction in your wallet. Nothing moves until you approve it.
        </p>

        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <label className="p" style={{ fontWeight: 700 }}>
            USD amount (min ${minUsd})
          </label>
          <input className="input" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />

          {!accepted ? <DisclosuresCard accepted={accepted} onToggle={setAccepted} compact /> : null}

          <button
            className="btn btn--primary"
            type="button"
            disabled={busy}
            onClick={() => send().catch((e) => setStatus(String(e?.message || e)))}
          >
            {busy ? "Opening Phantom..." : "Confirm in Phantom"}
          </button>

          <button className="btn" type="button" disabled={busy} onClick={() => router.push(`/pots/${potIdFromQuery || currentPotId || ""}`)}>
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
