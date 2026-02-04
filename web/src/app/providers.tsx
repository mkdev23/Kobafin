"use client";

import React, { useMemo } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";
import { AuthProvider } from "@/lib/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  // DEVNET for PoC (easy to airdrop SOL and test real on-chain transfers).
  const endpoint = useMemo(() => clusterApiUrl("devnet"), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
  const privyConfig = useMemo<PrivyClientConfig>(
    () => ({
      appearance: { walletChainType: "solana-only" as const },
      loginMethods: ["sms", "email", "google", "apple", "wallet"] as const,
      embeddedWallets: { createOnLogin: "users-without-wallets" as const },
      externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
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

  if (!privyAppId) return content;

  return (
    <PrivyProvider appId={privyAppId} config={privyConfig}>
      {content}
    </PrivyProvider>
  );
}
