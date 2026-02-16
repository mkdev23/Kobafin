"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/auth-context";
import { PrivyAuthButton } from "@/components/privy-auth-button";

function toAuthErrorMessage(err: unknown, fallback: string) {
  const msg = String((err as any)?.message || err || "").trim();
  if (!msg) return fallback;
  if (msg === "wallet_not_connected") return "No wallet connected yet. Connect your wallet to continue.";
  if (msg === "wallet_cannot_sign_message") return "Connected wallet cannot sign messages.";
  if (msg === "bad_signature") return "Signature verification failed. Please try again.";
  if (msg.includes("rejected")) return "Request was rejected in wallet. Please approve to continue.";
  return msg;
}

export default function LoginPage() {
  const router = useRouter();
  const { setVisible } = useWalletModal();
  const wallet = useWallet();
  const { loginWithSIWS, token, isReady } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingConnectAndSignIn, setPendingConnectAndSignIn] = useState(false);
  const privyEnabled = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  useEffect(() => {
    if (!isReady) return;
    if (token) router.replace("/home");
  }, [isReady, token, router]);

  useEffect(() => {
    if (!pendingConnectAndSignIn || !wallet.connected) return;
    setPendingConnectAndSignIn(false);
    (async () => {
      setErr(null);
      try {
        setBusy(true);
        await loginWithSIWS();
        router.push("/home");
      } catch (e: any) {
        setErr(toAuthErrorMessage(e, "Sign-in failed"));
      } finally {
        setBusy(false);
      }
    })();
  }, [pendingConnectAndSignIn, wallet.connected, loginWithSIWS, router]);

  async function handleSIWS() {
    setErr(null);
    if (!wallet.connected) {
      setPendingConnectAndSignIn(true);
      setVisible(true);
      return;
    }
    try {
      setBusy(true);
      await loginWithSIWS();
      router.push("/home");
    } catch (e: any) {
      setErr(toAuthErrorMessage(e, "Sign-in failed"));
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
            onError={(msg) => setErr(toAuthErrorMessage(msg, "Privy sign-in failed"))}
            loginWithSIWS={loginWithSIWS}
            failureMessage="Privy sign-in failed"
          />
        ) : null}

        {privyEnabled ? <div className="smalllinks">Or continue with your Solana wallet</div> : null}

        <button type="button" onClick={handleSIWS} disabled={busy} className="btn btn--primary btn--full">
          {wallet.connected
            ? busy
              ? "Signing in..."
              : "Sign in with wallet"
            : pendingConnectAndSignIn
              ? "Connecting wallet..."
              : "Connect & sign with wallet"}
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
