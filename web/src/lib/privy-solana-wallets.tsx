"use client";

import React, { createContext, useContext } from "react";
import { useSolanaWallets, type ConnectedSolanaWallet } from "@privy-io/react-auth/solana";

const PrivySolanaWalletsContext = createContext<ConnectedSolanaWallet[]>([]);

export function PrivySolanaWalletsProvider({ children }: { children: React.ReactNode }) {
  const { wallets } = useSolanaWallets();
  return <PrivySolanaWalletsContext.Provider value={wallets}>{children}</PrivySolanaWalletsContext.Provider>;
}

export function EmptyPrivySolanaWalletsProvider({ children }: { children: React.ReactNode }) {
  return <PrivySolanaWalletsContext.Provider value={[]}>{children}</PrivySolanaWalletsContext.Provider>;
}

export function usePrivySolanaWallets() {
  return useContext(PrivySolanaWalletsContext);
}
