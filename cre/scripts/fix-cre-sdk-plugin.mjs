import { copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve("node_modules", "@chainlink", "cre-sdk-javy-plugin", "dist");
const src = join(dist, "javy_chainlink_sdk.wasm");
const dst = join(dist, "javy-chainlink-sdk.plugin.wasm");

if (!existsSync(src)) {
  console.warn(`[cre-sdk-fix] source not found: ${src}`);
  process.exit(0);
}

if (existsSync(dst)) {
  console.log(`[cre-sdk-fix] plugin already exists: ${dst}`);
  process.exit(0);
}

copyFileSync(src, dst);
console.log(`[cre-sdk-fix] created plugin alias: ${dst}`);
