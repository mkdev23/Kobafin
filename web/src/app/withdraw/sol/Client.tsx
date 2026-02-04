"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useSearchParams, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { api, Pot } from "@/lib/api";
import { useCurrentPot } from "@/lib/current-pot";
import { sendPreparedTransaction } from "@/lib/solana-tx";

export default function WithdrawSolPage() {
  const { token, user } = useAuth();
  const { connection } = useConnection();
  const wallet = useWallet();
  const { potId: currentPotId, setPotId } = useCurrentPot();

  const sp = useSearchParams();
  const router = useRouter();

  const potIdFromQuery = sp.get("potId") || "";

  const [usd, setUsd] = useState<string>("10");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pot, setPot] = useState<Pot | null>(null);

  const usdNumber = useMemo(() => Number(usd), [usd]);
  const lockedUntil = useMemo(() => {
    if (!user?.recoveryLockedUntil) return null;
    const d = new Date(user.recoveryLockedUntil);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [user?.recoveryLockedUntil]);
  const isLocked = lockedUntil ? lockedUntil.getTime() > Date.now() : false;

  useEffect(() => {
    if (potIdFromQuery) setPotId(potIdFromQuery);
  }, [potIdFromQuery, setPotId]);

  useEffect(() => {
    let cancelled = false;
    async function loadPot() {
      const potId = potIdFromQuery || currentPotId;
      if (!token || !potId) return;
      try {
        const res = await api<{ pot: Pot }>(`/v1/pots/${encodeURIComponent(potId)}`, { token });
        if (!cancelled) setPot(res.pot);
      } catch {
        if (!cancelled) setPot(null);
      }
    }
    loadPot();
    return () => {
      cancelled = true;
    };
  }, [token, potIdFromQuery, currentPotId]);

  async function send() {
    setStatus("");
    if (!token) throw new Error("Sign in first");
    if (!wallet.publicKey) throw new Error("Connect Phantom");
    if (user?.walletAddress && wallet.publicKey.toBase58() !== user.walletAddress) {
      throw new Error(`Wallet mismatch. Please connect ${user.walletAddress} and try again.`);
    }
    const potId = potIdFromQuery || currentPotId;
    if (!potId) throw new Error("Select a pot first");
    if (!Number.isFinite(usdNumber) || usdNumber <= 0) throw new Error("Enter a valid USD amount");

    setBusy(true);
    try {
      const prep = await api<{
        withdrawalId: string;
        usd: number;
        feeUsd?: number;
        netUsd?: number;
        solPriceUsd: number;
        sol: number;
        lamports: number;
        feeLamports?: number;
        vaultPda: string;
        txBase64: string;
        txVersion?: "legacy" | "v0";
      }>("/v1/withdrawals/sol/prepare", { method: "POST", token, body: { potId, usd: usdNumber } });

      const sig = await sendPreparedTransaction({
        txBase64: prep.txBase64,
        txVersion: prep.txVersion,
        connection,
        wallet,
        preflightCommitment: "confirmed",
        simulate: true,
      });
      await connection.confirmTransaction(sig, "confirmed");

      const conf = await api<{ ok: boolean; status: string }>("/v1/withdrawals/sol/confirm", {
        method: "POST",
        token,
        body: { withdrawalId: prep.withdrawalId, signature: sig },
      });

      setStatus(
        `Withdrawal submitted\n\nUSD: $${prep.usd}\nFee: $${prep.feeUsd ?? 0}\nNet: $${prep.netUsd ?? prep.usd}\nSOL/USD: ${prep.solPriceUsd}\nSOL: ${prep.sol}\nLamports: ${prep.lamports}\nFee Lamports: ${prep.feeLamports ?? 0}\nVault PDA: ${prep.vaultPda}\nSignature: ${sig}\nStatus: ${conf.status}`
      );

      // send user back to pot after a short delay
      setTimeout(() => router.push(`/pots/${potId}`), 800);
    } finally {
      setBusy(false);
    }
  }

  function formatWalletError(e: any) {
    // wallet adapter errors often include logs / signature / code
    const parts: string[] = [];
    const msg = e?.message || String(e);
    if (String(msg).includes("recovery_lock")) {
      return "Withdrawals are temporarily locked after recovery. Please try again later.";
    }
    parts.push(msg);
    if (e?.name) parts.push(`\nError: ${e.name}`);
    if (e?.code) parts.push(`\nCode: ${e.code}`);
    if (Array.isArray(e?.logs) && e.logs.length) {
      parts.push(`\nLogs:\n${e.logs.join("\n")}`);
    }
    return parts.join("\n");
  }

  return (
    <div className="container" style={{ padding: 16 }}>
      <div className="stack" style={{ maxWidth: 520, margin: "0 auto" }}>
        <div className="h1">Withdraw (Devnet Escrow)</div>
        <p className="p">
          Withdraw SOL from the <b>per-pot escrow vault</b> back to your wallet. Amount is entered in <b>USD</b> and
          converted to SOL using a live quote.
        </p>
        {isLocked ? (
          <div className="card" style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
            <div className="text-sm font-semibold">Withdrawal lock active</div>
            <p className="mt-1 text-xs text-slate-900">
              Withdrawals are temporarily locked after recovery. Locked until {lockedUntil?.toLocaleString()}.
            </p>
          </div>
        ) : null}
        {pot?.isLocked ? (
          <div className="card" style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
            <div className="text-sm font-semibold">Pot is locked</div>
            <p className="mt-1 text-xs text-slate-900">
              You can still withdraw any time. A 15% fee will be sent to the admin vault.
            </p>
          </div>
        ) : null}

        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <label className="p" style={{ fontWeight: 700 }}>
            USD amount
          </label>
          <input className="input" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />

          <button
            className="btn btn--primary"
            type="button"
            disabled={busy}
            onClick={() =>
              send().catch((e) => {
                setStatus(formatWalletError(e));
              })
            }
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

