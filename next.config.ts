import path from "node:path";
import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds a fully static site for GitHub Pages.
//
// The three data routes are force-dynamic when served normally (always reflect
// the DB). A static export cannot do that, so in export mode they prerender at
// build time instead, with generateStaticParams enumerating every community.
// The published snapshot is therefore frozen at build time — which is the point:
// Pages serves a reproducible demo, not a live app.
const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // Monorepo-ish environment (sibling lockfiles under ~/.openclaw) — pin the
  // workspace root to this repo so Turbopack doesn't infer a wrong root.
  turbopack: {
    root: path.join(__dirname),
  },
  ...(isStaticExport
    ? {
        output: "export" as const,
        // GitHub Pages project sites are served from /<repo>/, so asset URLs
        // need that prefix. Without it every _next/* asset 404s.
        basePath: process.env.PAGES_BASE_PATH || "",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
