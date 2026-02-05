"use client";

import { useState } from "react";
import bs58 from "bs58";
import { useLogin } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

type LoginWithSiws = (opts?: {
  walletAddress?: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  chain?: string;
}) => Promise<void>;

export function PrivyAuthButton({
  onSuccess,
  onError,
  loginWithSIWS,
  failureMessage = "Privy auth failed",
  ctaLabel = "Continue with phone or social",
}: {
  onSuccess: () => void;
  onError: (msg: string) => void;
  loginWithSIWS: LoginWithSiws;
  failureMessage?: string;
  ctaLabel?: string;
}) {
  const { wallets, createWallet } = useSolanaWallets();
  const [busy, setBusy] = useState(false);

  function isBase58Address(addr: string) {
    try {
      bs58.decode(addr);
      return true;
    } catch {
      return false;
    }
  }

  function pickSolanaAddress(user: any) {
    const linkedSol = (user?.linkedAccounts || []).find(
      (acct: any) => acct?.type === "wallet" && acct?.chainType === "solana"
    );
    const linkedAddr = linkedSol?.address;
    if (linkedAddr && isBase58Address(linkedAddr)) return linkedAddr;
    const wallet = wallets.find((w: any) => w?.type === "solana");
    const walletAddr = wallet?.address;
    if (walletAddr && isBase58Address(walletAddr)) return walletAddr;
    return "";
  }

  async function waitForSolanaWallet(timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const solWallet = wallets.find(
        (w: any) => w?.type === "solana" && typeof w?.signMessage === "function"
      );
      if (solWallet) return solWallet;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  const { login } = useLogin({
    onComplete: async (user) => {
      setBusy(true);
      try {
        let walletAddress = pickSolanaAddress(user);
        if (!walletAddress) {
          const created = await createWallet();
          const createdAddr = (created as any)?.address;
          walletAddress = createdAddr && isBase58Address(createdAddr) ? createdAddr : "";
        }
        if (!walletAddress) throw new Error("privy_wallet_missing");

        const solWallet =
          (wallets.find(
            (w: any) => w?.type === "solana" && typeof w?.signMessage === "function"
          ) as any) || (await waitForSolanaWallet());
        if (!solWallet?.signMessage) {
          throw new Error("privy_sign_message_missing");
        }

        await loginWithSIWS({
          walletAddress,
          signMessage: async (message) => {
            return solWallet.signMessage(message);
          },
          chain: "solana:devnet",
        });
        onSuccess();
      } catch (e: any) {
        if (e?.message === "privy_sign_message_missing") {
          onError("Privy wallet not ready. Please wait a moment and try again.");
        } else {
          onError(e?.message || failureMessage);
        }
      } finally {
        setBusy(false);
      }
    },
    onError: (e) => {
      if (e) onError(String((e as any)?.message || e));
    },
  });

  return (
    <button type="button" onClick={() => login()} disabled={busy} className="btn btn--primary btn--full">
      {busy ? "Opening Privy..." : ctaLabel}
    </button>
  );
}
