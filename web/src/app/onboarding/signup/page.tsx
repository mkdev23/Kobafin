"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth-context";
import { PrivyAuthButton } from "@/components/privy-auth-button";

export default function SignupPage() {
  const router = useRouter();
  const { setVisible } = useWalletModal();
  const wallet = useWallet();
  const { loginWithSIWS } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
      router.push("/onboarding/form");
    } catch (e: any) {
      setErr(e?.message || "Sign-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="section">
        <div className="h1">Sign up</div>
      </div>

      <div className="form">
        <div className="label">Phone number *</div>
        <input className="input" placeholder="+ 232 00 000 000" />

        {privyEnabled ? (
          <PrivyAuthButton
            onSuccess={() => router.push("/onboarding/form")}
            onError={(msg) => setErr(msg)}
            loginWithSIWS={loginWithSIWS}
            failureMessage="Privy sign-up failed"
          />
        ) : null}

        <button type="button" onClick={handleSIWS} disabled={busy} className="btn btn--primary btn--full">
          {wallet.connected ? (busy ? "Signing up..." : "Sign up") : "Connect wallet"}
        </button>

        <Link href="/onboarding/verify" className="btn btn--ghost btn--full">
          Continue with demo OTP flow
        </Link>

        {err ? <div className="smalllinks" style={{ color: "#dc2626" }}>{err}</div> : null}

        <div className="smalllinks">
          By signing up you agree to our <a href="#">Terms of Condition</a> and <a href="#">Privacy Policy</a>.
        </div>

        <div className="smalllinks">
          Already have an account? <Link href="/onboarding/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
