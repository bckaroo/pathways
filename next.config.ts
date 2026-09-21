import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo-ish environment (sibling lockfiles under ~/.openclaw) — pin the
  // workspace root to this repo so Turbopack doesn't infer a wrong root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;