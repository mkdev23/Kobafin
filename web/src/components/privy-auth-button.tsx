"use client";

import { useEffect, useRef, useState } from "react";
import bs58 from "bs58";
import { useLogin } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { getSiwsChainFromEnv } from "@/lib/solana-network";

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
  const walletsRef = useRef(wallets);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    walletsRef.current = wallets;
  }, [wallets]);

  function isBase58Address(addr: string) {
    try {
      bs58.decode(addr);
      return true;
    } catch {
      return false;
    }
  }

  function currentSolanaWallet() {
    return walletsRef.current.find(
      (w: any) => w?.type === "solana" && typeof w?.signMessage === "function"
    ) as any;
  }

  async function waitForSolanaWallet(timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const wallet = currentSolanaWallet();
      if (wallet) return wallet;
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  function mapPrivyError(message: string) {
    if (message === "privy_sign_message_missing") {
      return "Your Solana wallet is not ready yet. Please wait a moment and try again.";
    }
    if (message === "privy_wallet_missing") {
      return "No Solana wallet found for this account. Please try again.";
    }
    if (message.includes("rejected")) {
      return "Request was rejected in wallet. Please approve to continue.";
    }
    return message;
  }

  function normalizeSignatureBytes(raw: any): Uint8Array {
    if (raw instanceof Uint8Array) return raw;
    if (Array.isArray(raw)) return Uint8Array.from(raw);
    if (raw?.signature) return normalizeSignatureBytes(raw.signature);
    if (typeof raw === "string") {
      try {
        return bs58.decode(raw);
      } catch {
        const clean = raw.startsWith("0x") ? raw.slice(2) : raw;
        if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
          return Uint8Array.from(Buffer.from(clean, "hex"));
        }
      }
    }
    throw new Error("privy_sign_message_invalid");
  }

  const { login } = useLogin({
    onComplete: async (user) => {
      setBusy(true);
      try {
        let solWallet = currentSolanaWallet();
        if (!solWallet) {
          await createWallet();
          solWallet = await waitForSolanaWallet();
        }
        if (!solWallet?.signMessage) throw new Error("privy_sign_message_missing");
        const walletAddress = solWallet?.address;
        if (!walletAddress || !isBase58Address(walletAddress)) throw new Error("privy_wallet_missing");

        await loginWithSIWS({
          walletAddress,
          signMessage: async (message) => normalizeSignatureBytes(await solWallet.signMessage(message)),
          chain: getSiwsChainFromEnv(),
        });
        onSuccess();
      } catch (e: any) {
        onError(mapPrivyError(String(e?.message || failureMessage)));
      } finally {
        setBusy(false);
      }
    },
    onError: (e) => {
      if (e) onError(mapPrivyError(String((e as any)?.message || e)));
    },
  });

  return (
    <button type="button" onClick={() => login()} disabled={busy} className="btn btn--primary btn--full">
      {busy ? "Opening Privy..." : ctaLabel}
    </button>
  );
}
