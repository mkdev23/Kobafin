import bs58 from "bs58";
import crypto from "crypto";

export function anchorDiscriminator(ixName: string): Uint8Array {
  return crypto.createHash("sha256").update("global:" + ixName).digest().subarray(0, 8);
}

export function decodeU64LE(data: Uint8Array): bigint {
  const b = Buffer.from(data);
  return b.readBigUInt64LE(0);
}

export function decodeInstructionData(data: string): Uint8Array {
  try {
    return bs58.decode(data);
  } catch {
    return Buffer.from(data, "base64");
  }
}

export function parseEscrowInstructionData(raw: Uint8Array) {
  if (raw.length < 8 + 32 + 8) {
    throw new Error("escrow_ix_data_too_short");
  }
  const discriminator = raw.subarray(0, 8);
  const potHash = raw.subarray(8, 40);
  const lamports = decodeU64LE(raw.subarray(40, 48));
  const feeLamports = raw.length >= 56 ? decodeU64LE(raw.subarray(48, 56)) : null;
  return { discriminator, potHash, lamports, feeLamports };
}
