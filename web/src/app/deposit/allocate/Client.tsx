"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useCurrentPot } from "@/lib/current-pot";
import { sendPreparedTransaction } from "@/lib/solana-tx";
import { DisclosuresCard, useDisclosureAcceptance } from "@/components/disclosures";

type AllocatePrep = {
  depositId: string;
  luloOpId?: string | null;
  txBase64: string;
  txVersion?: "legacy" | "v0";
  allocations: { usdc: number; btc: number; eth: number; sol: number };
  vaultPda: string;
};

export default function AllocateDepositPage() {
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
  const [luloStatus, setLuloStatus] = useState<{ enabled?: boolean; network?: string } | null>(null);

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
    api<{ enabled: boolean; network?: string }>("/v1/lulo/status")
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
    if (mainnetMismatch) throw new Error("Mainnet required. Switch your RPC to mainnet-beta.");
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
      const prep = await api<AllocatePrep>("/v1/deposits/allocate/prepare", {
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

      await api<{ ok: boolean; status: string }>("/v1/deposits/allocate/confirm", {
        method: "POST",
        token,
        body: { depositId: prep.depositId, signature: sig, luloOpId: prep.luloOpId || undefined },
      });

      setStatus(
        [
          "Allocation confirmed.",
          `USD: $${usdNumber.toFixed(2)}`,
          `USDC -> Lulo: $${prep.allocations.usdc.toFixed(2)}`,
          `BTC: $${prep.allocations.btc.toFixed(2)}`,
          `ETH: $${prep.allocations.eth.toFixed(2)}`,
          `SOL: $${prep.allocations.sol.toFixed(2)}`,
          `Vault: ${prep.vaultPda}`,
          `Tx: ${sig}`,
        ].join("\n")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Deposit + Allocate (single tx)</div>
        <p className="p">
          One transaction: fund the vault, allocate USDC into Lulo Protect/Boosted, and swap into BTC/ETH/SOL.
        </p>
        <p className="p">
          You will sign a single on-chain transaction. Nothing moves until you approve it.
        </p>

        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <label className="p" style={{ fontWeight: 700 }}>
            USD amount (min {minUsd})
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
              This allocation flow requires mainnet. Switch your wallet RPC to mainnet-beta.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

