"use client";



import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";

import Link from "next/link";

import dynamic from "next/dynamic";

import { api, Pot } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { sendPreparedTransaction } from "@/lib/solana-tx";



const WalletMultiButton = dynamic(

  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,

  { ssr: false }

);



type FlowState = "idle" | "needs_auth" | "needs_wallet" | "building_tx" | "signing" | "confirming" | "done" | "error";



export default function WithdrawPage() {

  const params = useParams();

  const potId = String(params.id || "");

  const [amountUsd, setAmountUsd] = useState(100);

  const [state, setState] = useState<FlowState>("idle");

  const [message, setMessage] = useState("");

  const [signature, setSignature] = useState("");
  const [pot, setPot] = useState<Pot | null>(null);


  const { token, user } = useAuth();
  const wallet = useWallet();
  const { connection } = useConnection();

  const canSubmit = useMemo(() => amountUsd > 0 && !!potId, [amountUsd, potId]);
  const lockedUntil = useMemo(() => {
    if (!user?.recoveryLockedUntil) return null;
    const d = new Date(user.recoveryLockedUntil);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [user?.recoveryLockedUntil]);
  const isLocked = lockedUntil ? lockedUntil.getTime() > Date.now() : false;

  useEffect(() => {
    let cancelled = false;
    async function loadPot() {
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
  }, [token, potId]);

  async function runWithdraw() {

    if (!canSubmit) return;

    if (!token) {

      setState("needs_auth");

      return;

    }

    if (!wallet.connected || !wallet.publicKey) {

      setState("needs_wallet");

      return;

    }



    try {

      setState("building_tx");

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

      }>("/v1/withdrawals/sol/prepare", {

        token,

        body: { potId, usd: amountUsd },

      });



      setState("signing");

      const sig = await sendPreparedTransaction({

        txBase64: prep.txBase64,

        txVersion: prep.txVersion,

        connection,

        wallet,

        preflightCommitment: "confirmed",

      });

      await connection.confirmTransaction(sig, "confirmed");

      setSignature(sig);



      setState("confirming");

      await api<{ ok: boolean; status: string }>("/v1/withdrawals/sol/confirm", {

        token,

        body: { withdrawalId: prep.withdrawalId, signature: sig },

      });



      setState("done");

      setMessage(

        `Withdraw submitted. $${prep.usd.toFixed(2)} (${(prep.netUsd ?? prep.usd).toFixed(2)} net, fee $${(prep.feeUsd ?? 0).toFixed(2)})  ${prep.sol.toFixed(4)} SOL @ $${prep.solPriceUsd.toFixed(2)}`

      );

    } catch (e: any) {

      setState("error");
      const msg = String(e?.message || e);
      setMessage(
        msg.includes("recovery_lock")
          ? "Withdrawals are temporarily locked after recovery. Please try again later."
          : msg
      );

    }

  }



  return (

    <div className="p-4">

      <div className="rounded-2xl border border-black/10 bg-white p-4">

        <div className="text-sm font-semibold">Withdraw</div>
        <p className="mt-1 text-xs text-slate-900">Enter a USD amount to withdraw. We convert to SOL at current rate.</p>
        {isLocked ? (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Withdrawals are temporarily locked after recovery. Locked until {lockedUntil?.toLocaleString()}.
          </div>
        ) : null}
        {pot?.isLocked ? (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            This pot is locked. You can withdraw anytime, but a 15% fee will be sent to the admin vault.
          </div>
        ) : null}


        <div className="mt-4">

          <label className="text-xs font-semibold text-slate-900">Amount (USD)</label>

          <input

            type="number"

            min={1}

            value={amountUsd}

            onChange={(e) => setAmountUsd(Number(e.target.value))}

            className="mt-1 w-full rounded-xl border border-black/10 px-4 py-3 text-sm"

          />

        </div>



        <div className="mt-4">

          <button

            className="w-full rounded-xl bg-[var(--kb-blue)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"

            disabled={!canSubmit}

            onClick={() => runWithdraw()}

          >

            Withdraw

          </button>

        </div>



        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-900">

          <div>Status: {state.replace(/_/g, " ")}</div>

          {message ? <div className="mt-1">{message}</div> : null}

          {signature ? <div className="mt-1 break-all">Tx: {signature}</div> : null}

        </div>



        {state === "needs_wallet" ? (

          <div className="mt-4">

            <WalletMultiButton />

          </div>

        ) : null}



        {state === "needs_auth" ? (

          <div className="mt-4 text-xs text-slate-900">Sign in first to withdraw.</div>

        ) : null}



        <div className="mt-4">

          <Link href={`/pots/${potId}`} className="text-xs font-semibold text-[var(--kb-blue)]">

            ? Back to pot

          </Link>

        </div>

      </div>

    </div>

  );

}

