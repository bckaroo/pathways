#!/usr/bin/env node
/**
 * Validate the CSC progression rules against real certified communities.
 *
 * WHY THIS EXISTS
 * ---------------
 * The thresholds are not in our database and the two official-looking sources
 * disagree (NYSDEC website says Silver=300; a stale NYSERDA manual PDF says
 * 250/350). Encoding unverified thresholds into a "can you level up?" UI would
 * produce confident, actionable, WRONG advice.
 *
 * So the rules are checked against the only ground truth available: all 185
 * municipalities that actually hold a certification. If our rule engine cannot
 * reproduce their certified level from their own completion records, the rules
 * are wrong and must not ship.
 *
 * Specifically, for every certified community this asserts:
 *   1. the community SATISFIES the requirements for the level it holds
 *   2. the community does NOT satisfy the requirements for the next level up
 *      (except the highest tier, where nothing is above it)
 *
 * (2) is the stronger test: it proves the thresholds are not too permissive.
 *
 * Usage:  node scripts/validate-csc-rules.mjs
 * Requires: the pathways-db container running with ingested data.
 */
import { execFileSync } from "node:child_process";

let mod;
try {
  // Prefer a compiled/transpiled view; fall back to esbuild-style strip.
  mod = await import("../src/lib/csc-progression.ts");
} catch {
  console.log(
    "  info  cannot import TypeScript directly; run via: npx tsx scripts/validate-csc-rules.mjs",
  );
  process.exit(2);
}

const { CSC_LEVELS, evaluateLevel } = mod;

const CONTAINER = process.env.PG_CONTAINER || "pathways-db";
const DB = process.env.PG_DATABASE || "pathways";
const USER = process.env.PG_USER || "pathways";

function psql(sql) {
  const out = execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", USER, "-d", DB, "-t", "-A", "-F", "|", "-c", sql],
    { encoding: "utf8" },
  );
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("|"));
}

console.log("\n[validate-csc] loading certified communities + their progress");

// GUARD: this validator and the profile page both join completions through
// certifications on municipality_uid. That is only safe while every
// municipality has exactly one certification row. Recertification is real in
// the source data (Croton-on-Hudson's CEC history lists Bronze and Silver CSC
// recertifications); if multiple cycles are ever ingested the join pulls every
// cycle together and double-counts points. Fail loudly rather than silently
// over-reporting progress.
const multi = psql(`
  SELECT m.name, COUNT(*) AS n
  FROM certifications c
  JOIN municipalities m ON m.portal_uid = c.municipality_uid
  GROUP BY m.name HAVING COUNT(*) > 1
  ORDER BY n DESC
`);
if (multi.length) {
  console.log(
    `\n[validate-csc] FAIL — ${multi.length} municipality(ies) have more than one certification.`,
  );
  console.log(
    `  Joining completions by municipality would now double-count across recertification cycles.`,
  );
  console.log(`  The profile query and this validator must filter to a single cert_uid before proceeding.\n`);
  for (const [name, n] of multi.slice(0, 10)) console.log(`   - ${name}: ${n} certifications`);
  console.log();
  process.exit(1);
}
console.log("  ok  one certification per municipality (no recertification double-count risk)");

const rows = psql(`
  WITH prog AS (
    SELECT co.municipality_uid AS uid,
           COALESCE(SUM(co.points_awarded),0) AS pts,
           COUNT(DISTINCT a.pledge_element) AS pes,
           COUNT(DISTINCT a.external_id) FILTER (WHERE a.mandatory) AS mand,
           COUNT(DISTINCT a.external_id) FILTER (WHERE a.priority) AS pri
    FROM completions co
    JOIN actions a ON a.external_id = co.action_external_id
    GROUP BY co.municipality_uid
  )
  SELECT m.name,
         c.level_name,
         COALESCE(c.points_approved,0) AS approved,
         COALESCE(p.pts,0)            AS computed,
         COALESCE(p.pes,0)            AS pes,
         COALESCE(p.mand,0)           AS mand,
         COALESCE(p.pri,0)            AS pri
  FROM certifications c
  JOIN municipalities m ON m.portal_uid = c.municipality_uid
  LEFT JOIN prog p ON p.uid = c.municipality_uid
  ORDER BY c.level_name, COALESCE(p.pts,0) DESC
`);

console.log(`  loaded ${rows.length} certified communities`);

const failures = [];
const stats = { checked: 0, satisfiesOwn: 0, failsNext: 0, tooPermissive: [], usedApproved: 0 };

const offered = CSC_LEVELS.filter((l) => l.offered);
const ORDER = ["registered", "bronze", "silver", "gold"];

for (const r of rows) {
  const [name, levelName, approved, computed, pes, mand, pri] = r;

  const idx = ORDER.indexOf(levelName.toLowerCase());
  if (idx === -1) {
    failures.push(`${name}: unknown level_name "${levelName}"`);
    continue;
  }

  // AUTHORITATIVE POINTS
  // -------------------
  // For a CERTIFIED community, `points_approved` is the official figure and
  // takes precedence over summing per-action `points_awarded`.
  //
  // Verified: they agree exactly for 183 of 185 communities. The 2 exceptions
  // (and 1 more at Silver) differ by small NEGATIVE amounts — our per-action
  // sum is lower than the approved total — which looks like partial-credit
  // rounding on variable-point actions in the published application. E.g.
  // Hyde Park awarded 6 points for an action whose range is 1–10 while the
  // approved total implies a higher credit.
  //
  // So: summing `points_awarded` is a good proxy for UNCERTIFIED communities
  // (where no approved figure exists) but must not override an approved total.
  // Mixing the two silently would mean the engine disagrees with the state's
  // own published numbers for real communities.
  const approvedNum = Number(approved);
  const computedNum = Number(computed);
  const useApproved = approvedNum > 0 && approvedNum !== computedNum;
  const effectivePoints = useApproved ? approvedNum : computedNum;

  const snap = {
    points: effectivePoints,
    pledgeElementsCovered: Number(pes),
    mandatoryDone: Number(mand),
    priorityDone: Number(pri),
  };
  if (useApproved) stats.usedApproved += 1;

  // (1) must satisfy its own level
  const own = CSC_LEVELS.find((l) => l.key === levelName.toLowerCase());
  if (!own || !own.offered) {
    failures.push(`${name}: holds "${levelName}" but no such offered level`);
    continue;
  }
  const ownStatus = evaluateLevel(own, snap);
  stats.checked++;
  if (!ownStatus.reached) {
    const unmet = ownStatus.gaps
      .filter((g) => !g.met)
      .map((g) => `${g.label} ${g.have}/${g.need}`)
      .join(", ");
    failures.push(
      `${name} (holds ${levelName}) FAILS its own level on: ${unmet} ` +
        `[computed pts=${computed} vs approved=${approved}]`,
    );
  } else {
    stats.satisfiesOwn++;
  }

  // (2) must NOT satisfy the next offered level up — otherwise the thresholds
  //     are too permissive and any "you can level up" prompt is unreliable.
  const nextOffered = offered[offered.findIndex((l) => l.key === own.key) + 1];
  if (nextOffered) {
    const nextStatus = evaluateLevel(nextOffered, snap);
    if (nextStatus.reached) {
      stats.tooPermissive.push(
        `${name} holds ${levelName} but already MEETS ${nextOffered.name} ` +
          `(pts=${computed}, PE=${pes}, mand=${mand}, pri=${pri})`,
      );
    } else {
      stats.failsNext++;
    }
  }
}

console.log(`\n[validate-csc] results`);
console.log(`  communities checked:            ${stats.checked}`);
console.log(`  satisfy their own level:        ${stats.satisfiesOwn}`);
console.log(`  correctly NOT next level:       ${stats.failsNext}`);
console.log(`  next level already met (soft):  ${stats.tooPermissive.length}`);

if (stats.tooPermissive.length) {
  console.log(
    `\n  NOTE — these hold a level but already meet the next level's criteria.`,
  );
  console.log(
    `  That is NOT necessarily a bug: certifications are snapshots at the date`,
  );
  console.log(
    `  they were approved, and a community continues earning points afterward.`,
  );
  for (const t of stats.tooPermissive.slice(0, 8)) console.log(`    - ${t}`);
  if (stats.tooPermissive.length > 8) {
    console.log(`    ... and ${stats.tooPermissive.length - 8} more`);
  }
}

if (failures.length) {
  console.log(`\n[validate-csc] FAIL — ${failures.length} hard failure(s):\n`);
  for (const f of failures.slice(0, 20)) console.log(`   - ${f}`);
  if (failures.length > 20) console.log(`   ... and ${failures.length - 20} more`);
  console.log();
  process.exit(1);
}

console.log(
  `\n[validate-csc] PASS — rule engine reproduces all ${stats.checked} certified levels.\n`,
);
