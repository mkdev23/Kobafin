"use client";

import { useEffect, useRef, useState } from "react";
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
  const { wallets, ready, createWallet } = useSolanaWallets();
  const [busy, setBusy] = useState(false);
  const walletsRef = useRef(wallets);
  const readyRef = useRef(ready);

  useEffect(() => {
    walletsRef.current = wallets;
    readyRef.current = ready;
  }, [wallets, ready]);

  async function waitForWallet(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (readyRef.current && walletsRef.current.length > 0) return walletsRef.current[0];
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
