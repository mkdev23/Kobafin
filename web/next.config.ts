import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    // Prevent Next from selecting a parent folder as the workspace root when multiple lockfiles exist.
    root: __dirname,
  },
  eslint: {
    // Avoid build failures on Vercel due to eslint config resolution.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
