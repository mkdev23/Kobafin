"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Index() {
  const { token, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isReady) return;
    router.replace(token ? "/home" : "/onboarding/welcome");
  }, [isReady, token, router]);

  return (
    <div className="page">
      <div className="section">
        <div className="card" style={{ padding: 16 }}>Loading...</div>
      </div>
    </div>
  );
}
