"use client";

import { useEffect, useRef, useState } from "react";
import { useCreateWallet, useLogin, useWallets } from "@privy-io/react-auth";

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
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [busy, setBusy] = useState(false);
  const walletsRef = useRef(wallets);

  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);

  function getSolanaWallet() {
    return walletsRef.current.find((wallet: any) => wallet?.type === "solana") || null;
  }

  async function waitForWallet(timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const solWallet = getSolanaWallet();
      if (solWallet) return solWallet;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  const { login } = useLogin({
    onComplete: async () => {
      setBusy(true);
      try {
        let solWallet = await waitForWallet();
        if (!solWallet) {
          try {
            await createWallet();
          } catch {
            // ignore and retry wallet fetch
          }
          solWallet = await waitForWallet();
        }
        if (!solWallet) throw new Error("privy_wallet_missing");
        const walletAddress =
          (solWallet as any)?.address || String((solWallet as any)?.publicKey || "");
        if (!walletAddress) throw new Error("privy_wallet_missing");

        await loginWithSIWS({
          walletAddress,
          signMessage: async (message) => {
            if (!(solWallet as any)?.signMessage) {
              throw new Error("privy_sign_message_missing");
            }
            return (solWallet as any).signMessage(message);
          },
          chain: "solana:devnet",
        });
        onSuccess();
      } catch (e: any) {
        onError(e?.message || failureMessage);
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
