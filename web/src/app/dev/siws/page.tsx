"use client";

import { useState } from "react";
import bs58 from "bs58";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

export default function SiwsPage() {
  const wallet = useWallet();
  const { connection } = useConnection();

  const [jwt, setJwt] = useState("");
  const [status, setStatus] = useState<string>("");

  async function signInSIWS() {
    setStatus("");
    if (!wallet.publicKey) throw new Error("Connect wallet first");
    if (!wallet.signMessage) throw new Error("Wallet does not support signMessage");

    const chResp = await fetch(`${API}/v1/auth/siws/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: wallet.publicKey.toBase58(),
        domain: window.location.host,
        chain: "solana:testnet",
      }),
    });

    const ch = await chResp.json();
    if (!ch.message || !ch.nonce) throw new Error(`Challenge failed: ${JSON.stringify(ch)}`);

    const msgBytes = new TextEncoder().encode(ch.message);
    const sigBytes = await wallet.signMessage(msgBytes); // Uint8Array
    const signature = bs58.encode(sigBytes); // base58

    const vResp = await fetch(`${API}/v1/auth/siws/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: wallet.publicKey.toBase58(),
        nonce: ch.nonce,
        message: ch.message,
        signature,
      }),
    });

    const v = await vResp.json();
    if (!v.accessToken) throw new Error(`Verify failed: ${JSON.stringify(v)}`);

    setJwt(v.accessToken);
    setStatus("Signed in ✅");
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">KobaFin Dev — SIWS</h1>
          <p className="text-sm opacity-70">Testnet + Phantom</p>
        </div>
        <WalletMultiButton />
      </div>

      <div className="mt-4">
        <button
          className="w-full rounded-xl bg-[var(--kb-blue)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!wallet.connected}
          onClick={() => signInSIWS().catch((e) => setStatus(String(e?.message || e)))}
        >
          Sign in (SIWS)
        </button>
      </div>

      {status && <p className="mt-3 text-sm">{status}</p>}

      <pre className="mt-4 overflow-auto rounded-xl bg-black/90 p-4 text-xs text-green-300">
        {JSON.stringify(
          {
            wallet: wallet.publicKey?.toBase58(),
            connected: wallet.connected,
            jwt: jwt ? "yes" : "no",
            rpc: connection.rpcEndpoint,
          },
          null,
          2
        )}
      </pre>
    </div>
  );
}
