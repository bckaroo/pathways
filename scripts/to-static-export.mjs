#!/usr/bin/env node
/**
 * Rewrite the three DB-backed routes for a static export.
 *
 * WHY A REWRITE AND NOT A CONDITIONAL
 * -----------------------------------
 * Next.js resolves `export const dynamic` STATICALLY at build time. A computed
 * value is rejected outright:
 *
 *   Unsupported node type "ConditionalExpression" at "dynamic"
 *
 * so `process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic"`
 * cannot work. The directive must be a literal, which means the source has to
 * differ between the live deployment and the static export.
 *
 * This script performs that swap, and reverses it. The live source is the
 * source of truth in git; the export build is a derived state that is always
 * reverted afterwards, so a developer never commits the static variant by
 * accident.
 *
 *   node scripts/to-static-export.mjs apply     # force-dynamic -> force-static
 *   node scripts/to-static-export.mjs revert    # force-static -> force-dynamic
 *
 * Both operations are idempotent and verify their own result.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROUTES = [
  "src/app/map/page.tsx",
  "src/app/communities/page.tsx",
  "src/app/communities/[uid]/page.tsx",
];

const LIVE = 'export const dynamic = "force-dynamic";';
const STATIC_ = 'export const dynamic = "force-static";';

const mode = process.argv[2];
if (mode !== "apply" && mode !== "revert") {
  console.error("usage: to-static-export.mjs apply|revert");
  process.exit(2);
}

const from = mode === "apply" ? LIVE : STATIC_;
const to = mode === "apply" ? STATIC_ : LIVE;

let changed = 0;
const problems = [];

for (const rel of ROUTES) {
  const abs = path.join(ROOT, rel);
  let src;
  try {
    src = readFileSync(abs, "utf8");
  } catch (err) {
    problems.push(`${rel}: cannot read (${err.code})`);
    continue;
  }

  if (src.includes(to)) {
    // Already in the target state — idempotent no-op.
    continue;
  }
  if (!src.includes(from)) {
    problems.push(
      `${rel}: neither directive found. Expected ${JSON.stringify(from)}. ` +
        `Refusing to guess — the route shape may have changed.`,
    );
    continue;
  }

  writeFileSync(abs, src.replace(from, to));
  changed++;
}

if (problems.length) {
  console.error(`[to-static-export] ${mode} FAILED:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

// Verify the resulting state rather than trusting the write.
const wrong = [];
for (const rel of ROUTES) {
  const src = readFileSync(path.join(ROOT, rel), "utf8");
  const hasTarget = src.includes(to);
  const hasOther = src.includes(from);
  if (!hasTarget || hasOther) wrong.push(`${rel} (target=${hasTarget} other=${hasOther})`);
}
if (wrong.length) {
  console.error(`[to-static-export] verification failed after ${mode}:`);
  for (const w of wrong) console.error(`  - ${w}`);
  process.exit(1);
}

console.log(
  `[to-static-export] ${mode}: ${changed} file(s) changed, ` +
    `${ROUTES.length - changed} already correct, ${ROUTES.length} verified.`,
);
