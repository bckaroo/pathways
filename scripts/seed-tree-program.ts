/**
 * Seed a Pathways tech-tree program from an authored program JSON module
 * (schema: docs/pathways-program-schema.md). Idempotent — upserts programs +
 * actions by (program_slug, external_id). External id = "action-<N>" derived
 * from the module's numeric action ids.
 *
 * Usage: npx tsx scripts/seed-tree-program.ts [path/to/program.json]
 * Default: public/pathways/csc-ny.json → program slug "csc-tree".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { actions, programs } from "../src/db/schema";

const here = dirname(fileURLToPath(import.meta.url));
const modulePath = process.argv[2] ?? join(here, "..", "public", "pathways", "csc-ny.json");

const mod = JSON.parse(readFileSync(modulePath, "utf8"));
const slug = `csc-tree`; // separate from the checklist-ingested 'csc' program (DEV-149 data)

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for seeding');
  const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

const extId = (id: number) => `action-${id}`;

// 1. Upsert program row
await db
  .insert(programs)
  .values({
    slug,
    name: mod.name,
    agency: mod.jurisdiction,
    status: "active",
    sourceUrl: mod.source_url ?? null,
    jurisdiction: mod.jurisdiction,
    pointCeiling: mod.point_ceiling,
    levels: mod.levels,
    requiredActions: (mod.required_actions ?? []).map(extId),
    categories: mod.categories,
    categoryNames: mod.category_names,
    tiers: mod.tiers,
  })
  .onConflictDoUpdate({
    target: programs.slug,
    set: {
      name: mod.name,
      agency: mod.jurisdiction,
      sourceUrl: mod.source_url ?? null,
      jurisdiction: mod.jurisdiction,
      pointCeiling: mod.point_ceiling,
      levels: mod.levels,
      requiredActions: (mod.required_actions ?? []).map(extId),
      categories: mod.categories,
      categoryNames: mod.category_names,
      tiers: mod.tiers,
      updatedAt: new Date(),
    },
  });

// 2. Upsert actions
let count = 0;
for (const a of mod.actions) {
  const row = {
    programSlug: slug,
    externalId: extId(a.id),
    name: a.name,
    pledgeElement: a.category,
    legacyActionNo: String(a.id),
    legacyActionName: a.name,
    pointsDisplay: a.points ?? null,
    icon: a.icon ?? null,
    tier: a.tier !== undefined && a.tier !== null ? Number(a.tier) : null,
    treeWhy: a.why ?? null,
    prereqExternalIds: (a.prereq ?? []).map(extId),
    details: a.details ?? null,
    lookback: a.lookback ?? null,
    cobenefits: a.cobenefits ?? null,
    updatedAt: new Date(),
  };
  // points min/max when parseable, e.g. "12-16" or "4"
  const m = String(a.points ?? "").match(/(\d+)\s*(?:-|–)?\s*(\d+)?$/);
  if (m) {
    row.pointsDisplay = a.points;
    await db
      .insert(actions)
      .values(row)
      .onConflictDoUpdate({
        target: [actions.programSlug, actions.externalId],
        set: row,
      });
    count++;
  } else {
    console.warn(`skip (unparseable points): ${a.id} ${a.name}`);
  }
}

await pool.end();
  console.log(`seeded program "${slug}" from ${modulePath}: ${count} actions upserted`);
}

main().catch((e) => { console.error(e); process.exit(1); });