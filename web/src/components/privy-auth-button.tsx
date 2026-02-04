"use client";

import { useState } from "react";
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
  const { wallets } = useSolanaWallets();
  const [busy, setBusy] = useState(false);

  const { login } = useLogin({
    onComplete: async () => {
      setBusy(true);
      try {
        const solWallet = wallets[0];
        if (!solWallet) throw new Error("privy_wallet_missing");
        const walletAddress = (solWallet as any).address || String((solWallet as any).publicKey || "");
        if (!walletAddress) throw new Error("privy_wallet_missing");
        await loginWithSIWS({
          walletAddress,
          signMessage: async (message) => {
            if (!solWallet.signMessage) throw new Error("privy_sign_message_missing");
            return solWallet.signMessage(message);
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
