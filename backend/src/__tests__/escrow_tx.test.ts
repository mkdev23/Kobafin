import assert from "node:assert/strict";
import { anchorDiscriminator, parseEscrowInstructionData } from "../lib/escrow-tx";

function u64le(n: number | bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
}

const potHash = Buffer.alloc(32, 7);
const lamports = 123456789n;
const data = Buffer.concat([
  Buffer.from(anchorDiscriminator("deposit")),
  potHash,
  u64le(lamports),
]);

const parsed = parseEscrowInstructionData(data);
assert.equal(Buffer.from(parsed.discriminator).toString("hex"), Buffer.from(anchorDiscriminator("deposit")).toString("hex"));
assert.equal(Buffer.from(parsed.potHash).toString("hex"), potHash.toString("hex"));
assert.equal(parsed.lamports, lamports);

console.log("escrow tx parsing: ok");
