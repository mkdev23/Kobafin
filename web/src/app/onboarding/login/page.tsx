"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth-context";
import { PrivyAuthButton } from "@/components/privy-auth-button";

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
        {privyEnabled ? (
          <PrivyAuthButton
            onSuccess={() => router.push("/home")}
            onError={(msg) => setErr(msg)}
            loginWithSIWS={loginWithSIWS}
            failureMessage="Privy sign-in failed"
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
