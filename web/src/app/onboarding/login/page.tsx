"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLogin } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth-context";

function PrivyLoginButton({
  onSuccess,
  onError,
  loginWithSIWS,
}: {
  onSuccess: () => void;
  onError: (msg: string) => void;
  loginWithSIWS: (opts?: {
    walletAddress?: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    chain?: string;
  }) => Promise<void>;
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
        onError(e?.message || "Privy sign-in failed");
      } finally {
        setBusy(false);
      }
    },
    onError: (e) => {
      if (e) onError(String((e as any)?.message || e));
    },
  });

  return (
    <button
      type="button"
      onClick={() => login()}
      disabled={busy}
      className="btn btn--primary btn--full"
    >
      {busy ? "Opening Privy..." : "Continue with phone or social"}
    </button>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { setVisible } = useWalletModal();
  const wallet = useWallet();
  const { loginWithSIWS } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const privyEnabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  async function handleSIWS() {
    setErr(null);
    try {
      setBusy(true);
      if (!wallet.connected) {
        setVisible(true);
        return;
      }
      await loginWithSIWS();
      router.push("/home");
    } catch (e: any) {
      setErr(e?.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Sign in</div>
      </div>

      <div className="form">
        <div className="label">Phone number *</div>
        <input className="input" placeholder="+ 232 00 000 000" />

        {privyEnabled ? (
          <PrivyLoginButton
            onSuccess={() => router.push("/home")}
            onError={(msg) => setErr(msg)}
            loginWithSIWS={loginWithSIWS}
          />
        ) : null}

        <button type="button" onClick={handleSIWS} disabled={busy} className="btn btn--primary btn--full">
          {wallet.connected ? (busy ? "Signing in..." : "Sign in") : "Connect wallet"}
        </button>

        {err ? <div className="smalllinks" style={{ color: "#dc2626" }}>{err}</div> : null}

        <div className="smalllinks">
          By signing up you agree to our <a href="#">Terms of Condition</a> and <a href="#">Privacy Policy</a>.
        </div>

        <div className="smalllinks">
          Don't have an account? <Link href="/onboarding/signup">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
