"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth-context";
import { PrivyAuthButton } from "@/components/privy-auth-button";

export default function SignupPage() {
  const router = useRouter();
  const { setVisible } = useWalletModal();
  const wallet = useWallet();
  const { loginWithSIWS, token, isReady } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingConnectAndSignUp, setPendingConnectAndSignUp] = useState(false);
  const privyEnabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  useEffect(() => {
    if (!isReady) return;
    if (token) router.replace("/home");
  }, [isReady, token, router]);

  useEffect(() => {
    if (!pendingConnectAndSignUp || !wallet.connected) return;
    setPendingConnectAndSignUp(false);
    (async () => {
      setErr(null);
      try {
        setBusy(true);
        await loginWithSIWS();
        router.push("/home");
      } catch (e: any) {
        setErr(e?.message || "Sign-up failed");
      } finally {
        setBusy(false);
      }
    })();
  }, [pendingConnectAndSignUp, wallet.connected, loginWithSIWS, router]);

  async function handleSIWS() {
    setErr(null);
    if (!wallet.connected) {
      setPendingConnectAndSignUp(true);
      setVisible(true);
      return;
    }
    try {
      setBusy(true);
      await loginWithSIWS();
      router.push("/home");
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
        {privyEnabled ? (
          <PrivyAuthButton
            onSuccess={() => router.push("/home")}
            onError={(msg) => setErr(msg)}
            loginWithSIWS={loginWithSIWS}
            failureMessage="Privy sign-up failed"
          />
        ) : null}

        <button type="button" onClick={handleSIWS} disabled={busy} className="btn btn--primary btn--full">
          {wallet.connected
            ? busy
              ? "Signing up..."
              : "Sign up"
            : pendingConnectAndSignUp
              ? "Connecting wallet..."
              : "Connect wallet"}
        </button>

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
