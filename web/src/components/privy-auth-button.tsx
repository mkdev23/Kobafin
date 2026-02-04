"use client";

import { useState } from "react";
import bs58 from "bs58";
import { useCreateWallet, useLogin, useSignMessage } from "@privy-io/react-auth";

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
  const { createWallet } = useCreateWallet();
  const { signMessage: privySignMessage } = useSignMessage();
  const [busy, setBusy] = useState(false);

  function decodePrivySignature(sig: string): Uint8Array {
    if (/[+/=]/.test(sig)) {
      const bin = atob(sig);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    try {
      return bs58.decode(sig);
    } catch {
      const bin = atob(sig);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
  }

  const { login } = useLogin({
    onComplete: async (user) => {
      setBusy(true);
      try {
        let walletAddress = (user as any)?.wallet?.address;
        if (!walletAddress) {
          const created = await createWallet();
          walletAddress = (created as any)?.address;
        }
        if (!walletAddress) throw new Error("privy_wallet_missing");

        await loginWithSIWS({
          walletAddress,
          signMessage: async (message) => {
            const msg = new TextDecoder().decode(message);
            const signature = await privySignMessage(msg, undefined, walletAddress);
            return decodePrivySignature(signature);
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
