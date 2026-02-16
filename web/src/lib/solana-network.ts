"use client";

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

function normalize(input: string): SolanaCluster {
  const value = (input || "").trim().toLowerCase();
  if (value === "mainnet" || value === "mainnet-beta" || value === "mainnetbeta") {
    return "mainnet-beta";
  }
  if (value === "testnet") return "testnet";
  return "devnet";
}

export function getSolanaClusterFromEnv(): SolanaCluster {
  return normalize(process.env.NEXT_PUBLIC_SOLANA_CHAIN || "devnet");
}

export function getSiwsChainFromEnv(): string {
  const cluster = getSolanaClusterFromEnv();
  if (cluster === "mainnet-beta") return "solana:mainnet";
  if (cluster === "testnet") return "solana:testnet";
  return "solana:devnet";
}

