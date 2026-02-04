"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { api, User } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/auth";

type AuthState = {
  token: string | null;
  user: User | null;
  isReady: boolean;
  loginWithSIWS: (opts?: {
    walletAddress?: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    chain?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Load token once
  useEffect(() => {
    const t = getToken();
    setTokenState(t);
    setIsReady(true);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await api<{ user: User }>("/v1/me", { token });
      setUser(me.user);
    } catch {
      clearToken();
      setTokenState(null);
      setUser(null);
    }
  }, [token]);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const loginWithSIWS = useCallback(async (opts?: {
    walletAddress?: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    chain?: string;
  }) => {
    const walletAddress = opts?.walletAddress || wallet.publicKey?.toBase58();
    const signMessageFn = opts?.signMessage || wallet.signMessage;
    if (!walletAddress) throw new Error("wallet_not_connected");
    if (!signMessageFn) throw new Error("wallet_cannot_sign_message");

    // 1) challenge (backend generates nonce + message)
    const ch = await api<{ nonce: string; message: string; expiresAt: string }>(
      "/v1/auth/siws/challenge",
      {
        method: "POST",
        body: {
          walletAddress,
          domain: window.location.host,
          chain: opts?.chain || "solana:devnet",
        },
      }
    );

    // 2) sign message
    const msgBytes = new TextEncoder().encode(ch.message);
    const sigBytes = await signMessageFn(msgBytes); // Uint8Array signature
    const signature = bs58.encode(sigBytes); // base58 string

    // 3) verify signature → receive JWT
    const verifyRes = await api<{ accessToken: string; user: User }>(
      "/v1/auth/siws/verify",
      {
        method: "POST",
        body: {
          walletAddress,
          nonce: ch.nonce,
          message: ch.message,
          signature, // base58
        },
      }
    );

    setToken(verifyRes.accessToken);
    setTokenState(verifyRes.accessToken);
    setUser(verifyRes.user);
  }, [wallet.publicKey, wallet.signMessage]);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ token, user, isReady, loginWithSIWS, logout, refreshMe }),
    [token, user, isReady, loginWithSIWS, logout, refreshMe]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
