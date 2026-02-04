import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { potIdToHashBytes, derivePotVaultPda } from "../lib/escrow";

function hex(u8: Uint8Array) {
  return Buffer.from(u8).toString("hex");
}

const owner = new PublicKey("11111111111111111111111111111111");
const programId = new PublicKey("2uULLkMPZ7rJMhsixb1TLsgFCdE87xx9efdi2Z657sA6");
const potId = "test-pot-1";

const potHash = potIdToHashBytes(potId);
assert.equal(potHash.length, 32, "pot hash should be 32 bytes");
assert.equal(
  hex(potHash),
  "787af270e83f6ca75c746dd1f9a12678cf27869a51e9de8a09b4134f487e8411",
  "pot hash should be deterministic"
);

const [pda, bump] = derivePotVaultPda(owner, potHash, programId);
assert.equal(pda.toBase58(), "8yvGotouGu6bWL3yBYBRwvLpPjW7fuyQCZ2uYPemPqsB");
assert.equal(bump, 254);

const [pda2, bump2] = derivePotVaultPda(owner, potHash, programId);
assert.equal(pda2.toBase58(), pda.toBase58(), "same inputs should yield same PDA");
assert.equal(bump2, bump, "same inputs should yield same bump");

console.log("escrow helpers: ok");
