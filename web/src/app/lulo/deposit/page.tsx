"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCurrentPot } from "@/lib/current-pot";
import { sendPreparedTransaction } from "@/lib/solana-tx";
import { DisclosuresCard, useDisclosureAcceptance } from "@/components/disclosures";

export default function LuloDepositPage() {
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
  const [luloStatus, setLuloStatus] = useState<{
    enabled?: boolean;
    network?: string;
    apiBase?: string;
  } | null>(null);

  const usdNumber = useMemo(() => Number(usd), [usd]);
  const rpcEndpoint = (connection.rpcEndpoint || "").toLowerCase();
  const isMainnetRpc =
    rpcEndpoint.length > 0 &&
    !rpcEndpoint.includes("devnet") &&
    !rpcEndpoint.includes("testnet") &&
    !rpcEndpoint.includes("localhost");
  const mainnetMismatch = luloStatus?.network === "mainnet" && !isMainnetRpc;

  useEffect(() => {
    if (potIdFromQuery) setPotId(potIdFromQuery);
  }, [potIdFromQuery, setPotId]);

  useEffect(() => {
    let mounted = true;
    api<{ enabled: boolean; network?: string; apiBase?: string }>("/v1/lulo/status")
      .then((res) => {
        if (mounted) setLuloStatus(res);
      })
      .catch(() => {
        if (mounted) setLuloStatus({ enabled: false });
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function send() {
    setStatus("");
    if (!token) throw new Error("Sign in first");
    if (!wallet.publicKey) throw new Error("Connect Phantom");
    if (luloStatus && luloStatus.enabled === false) throw new Error("Lulo not configured");
    if (mainnetMismatch) throw new Error("Mainnet required for Lulo. Switch your RPC to mainnet-beta.");
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
        luloOpId: string;
        txBase64: string;
        txVersion?: "legacy" | "v0";
        mode?: string;
      }>("/v1/lulo/deposits/prepare", {
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

      await api<{ ok: boolean; status: string }>("/v1/lulo/deposits/confirm", {
        method: "POST",
        token,
        body: { luloOpId: prep.luloOpId, signature: sig },
      });

      setStatus(
        `Lulo allocation submitted.\nUSD: $${usdNumber.toFixed(2)}\nMode: ${prep.mode || "LULO"}\nTx: ${sig}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Allocate to Lulo</div>
        <p className="p">
          Move USDC from your vault into Lulo Protect/Boosted for this pot. You will sign a transaction in Phantom.
        </p>
        <p className="p">
          This creates an on-chain transaction you can view in your wallet. Nothing moves until you approve it.
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
            disabled={busy || mainnetMismatch || luloStatus?.enabled === false}
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

        {mainnetMismatch ? (
          <div className="card" style={{ marginTop: 12, borderColor: "#FDE68A", background: "#FFFBEB" }}>
            <div className="text-sm font-semibold">Mainnet required</div>
            <p className="mt-1 text-xs text-slate-900">
              Lulo is mainnet-only right now. Switch your wallet RPC to mainnet-beta to continue.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
