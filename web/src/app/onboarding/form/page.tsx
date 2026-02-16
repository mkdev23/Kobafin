"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function SignupFormPage() {
  const router = useRouter();
  const { token, isReady } = useAuth();

  useEffect(() => {
    if (!isReady) return;
    router.replace(token ? "/home" : "/onboarding/signup");
  }, [isReady, token, router]);

  return (
    <div className="page">
      <div className="section">
        <div className="card" style={{ padding: 16 }}>Redirecting...</div>
      </div>
    </div>
  );
}

