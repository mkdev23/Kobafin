import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";

export function potIdToHashBytes(potId: string): Uint8Array {
  return crypto.createHash("sha256").update(potId).digest();
}

export function potIdToHashHex(potId: string): string {
  return crypto.createHash("sha256").update(potId).digest("hex");
}

export function derivePotVaultPda(
  owner: PublicKey,
  potHash: Uint8Array,
  escrowProgramId: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pot_vault"), owner.toBuffer(), Buffer.from(potHash)],
    escrowProgramId
  );
}

export function deriveVaultPdaFromPotId(
  owner: PublicKey,
  potId: string,
  escrowProgramId: PublicKey
) {
  const potHash = potIdToHashBytes(potId);
  const [pda, bump] = derivePotVaultPda(owner, potHash, escrowProgramId);
  return { pda, bump, potHash };
}
