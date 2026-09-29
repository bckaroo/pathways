#!/usr/bin/env node
/**
 * Vendor the MapLibre v6 worker into public/maplibre/.
 *
 * WHY THIS EXISTS
 * ---------------
 * MapLibre v6 ships as ESM only and does all source/tile parsing inside a Web
 * Worker. That worker, `dist/maplibre-gl-worker.mjs`, imports a sibling chunk,
 * `dist/maplibre-gl-shared.mjs`, by RELATIVE path:
 *
 *     from "./maplibre-gl-shared.mjs"
 *
 * Inside a bundler, `import.meta.url` does not reliably resolve to that worker
 * file, so MapLibre's default worker URL 404s. The consequence is not a
 * visible error — it is a silent hang:
 *
 *   - the main module loads         OK
 *   - the style loads               OK
 *   - the canvas paints             OK
 *   - the source is *created*       OK
 *   - the source never loads        loaded=false, forever
 *   - NO error event is emitted     (worker failure is invisible to the main thread)
 *   - "load" therefore never fires  → every layer added in that handler is skipped
 *
 * The page still returns HTTP 200 with a populated legend. That is exactly how
 * this map was reported as "verified" while rendering nothing.
 *
 * The fix is a one-time `setWorkerUrl()` pointing at these vendored files.
 * BOTH files are required, in the SAME directory, because of the relative import.
 *
 * Run this after any maplibre-gl upgrade:
 *     node scripts/vendor-maplibre-worker.mjs
 *
 * It is idempotent and verifies the copy, so a version bump that changes the
 * worker no longer silently desyncs the served file from the installed one.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "public", "maplibre");

// The worker imports its sibling relatively, so both must live together.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

mkdirSync(destDir, { recursive: true });

let pkgVersion = "unknown";
try {
  const pkg = JSON.parse(
    readFileSync(join(root, "node_modules", "maplibre-gl", "package.json"), "utf8"),
  );
  pkgVersion = pkg.version;
} catch {
  console.error("[vendor-maplibre] maplibre-gl is not installed.");
  process.exit(1);
}

console.log(`[vendor-maplibre] maplibre-gl ${pkgVersion}`);

let changed = 0;
for (const file of FILES) {
  const src = join(root, "node_modules", "maplibre-gl", "dist", file);
  const dest = join(destDir, file);

  let srcStat;
  try {
    srcStat = statSync(src);
  } catch {
    console.error(`[vendor-maplibre] MISSING in package: dist/${file}`);
    process.exit(1);
  }

  copyFileSync(src, dest);

  const srcHash = sha(readFileSync(src));
  const destHash = sha(readFileSync(dest));
  if (srcHash !== destHash) {
    console.error(`[vendor-maplibre] HASH MISMATCH after copy for ${file}`);
    process.exit(1);
  }

  // Sanity: the worker must still reference its sibling relatively. If a
  // future release inlines or renames the shared chunk, this script should
  // fail loudly rather than vendor a worker that cannot resolve its imports.
  if (file === "maplibre-gl-worker.mjs") {
    const text = readFileSync(dest, "utf8");
    if (!text.includes("./maplibre-gl-shared.mjs")) {
      console.error(
        "[vendor-maplibre] WARNING: worker no longer imports " +
          '"./maplibre-gl-shared.mjs". Upstream layout changed — re-check ' +
          "which files need vendoring before trusting this copy.",
      );
      process.exit(1);
    }
    // A module worker cannot be served from a data: or blob: URL if it has
    // bare imports; it must be same-origin. Ensure no non-relative bare
    // specifiers slipped in that a browser would refuse to resolve.
    const bareImports = [...text.matchAll(/from\s*["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((s) => !s.startsWith(".") && !s.startsWith("/"));
    if (bareImports.length) {
      console.error(
        `[vendor-maplibre] WARNING: worker has bare imports that a browser ` +
          `cannot resolve: ${bareImports.join(", ")}`,
      );
      process.exit(1);
    }
  }

  console.log(`  vendored ${file}  ${srcStat.size}b  sha256:${destHash}`);
  changed++;
}

console.log(
  `[vendor-maplibre] OK — ${changed} file(s) in public/maplibre/ ` +
    `(pin: ${pkgVersion})`,
);
