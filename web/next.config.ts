import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    // Prevent Next from selecting a parent folder as the workspace root when multiple lockfiles exist.
    root: __dirname,
  },
};

export default nextConfig;
