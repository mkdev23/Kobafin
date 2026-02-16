"use client";

import React, { useMemo } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";
import { getSolanaClusterFromEnv } from "@/lib/solana-network";
import { EmptyPrivySolanaWalletsProvider, PrivySolanaWalletsProvider } from "@/lib/privy-solana-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";
import { AuthProvider } from "@/lib/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => clusterApiUrl(getSolanaClusterFromEnv()), []);
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
  const wallets = useMemo(
    () => (privyAppId ? [] : [new PhantomWalletAdapter()]),
    [privyAppId]
  );
  const privyConfig = useMemo<PrivyClientConfig>(
    () => ({
      appearance: { walletChainType: "solana-only" as const },
      loginMethods: ["sms", "email", "google", "apple"] as const,
      embeddedWallets: { createOnLogin: "users-without-wallets" as const },
    }),
    []
  );

  const content = (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AuthProvider>{children}</AuthProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );

  if (!privyAppId) return <EmptyPrivySolanaWalletsProvider>{content}</EmptyPrivySolanaWalletsProvider>;

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      <PrivySolanaWalletsProvider>{content}</PrivySolanaWalletsProvider>
    </PrivyProvider>
  );
}
