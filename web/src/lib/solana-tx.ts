import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Connection, Commitment } from "@solana/web3.js";
import { Transaction, VersionedTransaction } from "@solana/web3.js";

type TxVersion = "legacy" | "v0";

type SendPreparedTxParams = {
  txBase64: string;
  txVersion?: TxVersion | null;
  connection: Connection;
  wallet: WalletContextState;
  preflightCommitment?: Commitment;
  simulate?: boolean;
};

type SimResult = { err: unknown; logs?: string[] | null };

function formatSimError(sim: SimResult) {
  const logs = sim?.logs?.length ? `\nLogs:\n${sim.logs.join("\n")}` : "";
  return `Preflight simulation failed: ${JSON.stringify(sim?.err)}${logs}`;
}

export async function sendPreparedTransaction(params: SendPreparedTxParams): Promise<string> {
  const { txBase64, txVersion, connection, wallet, simulate } = params;
  const preflightCommitment = params.preflightCommitment ?? "confirmed";
  if (!wallet.publicKey) throw new Error("Connect Phantom");

  const raw = Buffer.from(txBase64, "base64");
  const isV0 = txVersion === "v0";

  if (isV0) {
    const vtx = VersionedTransaction.deserialize(raw);
    if (wallet.signTransaction) {
      const signed = await wallet.signTransaction(vtx as any);
      if (simulate) {
        const sim = await connection.simulateTransaction(signed as any);
        if (sim.value.err) throw new Error(formatSimError(sim.value as SimResult));
      }
      return connection.sendRawTransaction(signed.serialize(), { preflightCommitment });
    }
    return wallet.sendTransaction(vtx, connection, { preflightCommitment });
  }

  const tx = Transaction.from(raw);
  const { blockhash } = await connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  if (wallet.signTransaction) {
    const signed = await wallet.signTransaction(tx);
    if (simulate) {
      const sim = await connection.simulateTransaction(signed);
      if (sim.value.err) throw new Error(formatSimError(sim.value as SimResult));
    }
    return connection.sendRawTransaction(signed.serialize(), { preflightCommitment });
  }

  return wallet.sendTransaction(tx, connection, { preflightCommitment });
}
