/**
 * Sector analysis — which emissions sectors a community is actually working on.
 *
 * WHY THE SECTOR MAP IS CURATED AND NOT DERIVED
 * ---------------------------------------------
 * The obvious shortcut is to treat `pledge_element` as the sector. That is
 * wrong, and provably so, because the pledge elements are PROCESS categories
 * that cross-cut emitting sectors:
 *
 *   PE3 "Decrease energy use"        contains Fleet Inventory (transportation)
 *                                    AND HVAC Upgrades (buildings)
 *   PE6 "Implement climate-smart     contains Electric Vehicle Charging Stations
 *        land use"                    and Access to Public Transit
 *                                    (both transportation, not land use)
 *   PE1 "Build a climate-smart       is about forming a task force — no
 *        community"                   emitting sector at all
 *   PE9 "Inform and inspire"         is outreach — no emitting sector
 *
 * Using PE as sector would misattribute every fleet action to "energy" and
 * every transit action to "land use" — the same class of error as filtering a
 * GHG inventory on `conventional_accounting` and getting 243 instead of 354
 * mmt.
 *
 * The CSC legacy action numbers in `actions.legacy_action_no` also look like a
 * sector key (the old manual is organised `3.1 Buildings and Stationary
 * Equipment`, `6.8 Resource-efficient Transportation`) but 19 of 124 actions
 * have no legacy number AT ALL — and they are precisely the newest ones
 * (Thermal Energy Networks, Refrigerant Management Program, Organics
 * Management Plan, Clean Energy Upgrades). A legacy-derived scheme would
 * therefore systematically miss the modern programme.
 *
 * So the mapping is curated, one action at a time, against GPC-style sector
 * names, and lives in `csc-sectors.json`. It is verified for completeness:
 * every one of the 124 actions is assigned exactly once, and the verifier
 * fails if the catalogue changes without the map being updated.
 *
 * TWO MEANINGS OF "SECTOR WORK" — do not conflate them
 * ---------------------------------------------------
 *   offer      what the CSC programme makes AVAILABLE in each sector
 *              (fixed: 124 actions, 1,229 max points)
 *   activity   what THIS community has actually done
 *
 * The radial shows activity; the offer is the denominator, so a small sector
 * can read as "fully covered" without being large. Both are labelled.
 */

import sectorData from "./csc-sectors.json";

export type SectorKey = keyof typeof sectorData.sectors;

export const SECTORS = sectorData.sectors as Record<
  SectorKey,
  { label: string; short: string; color: string }
>;

const ACTION_SECTOR = sectorData.actionSector as Record<string, SectorKey>;

export const SECTOR_KEYS = Object.keys(SECTORS) as SectorKey[];

/** Actions with no sector mapping are surfaced, never silently dropped. */
export function sectorFor(externalId: string): SectorKey | null {
  return ACTION_SECTOR[externalId] ?? null;
}

export type SectorTotals = {
  sector: SectorKey;
  /** Points this community earned in the sector. */
  earned: number;
  /** Points the programme makes available in the sector. */
  available: number;
  /** earned / available, 0..1. */
  coverage: number;
  actionsDone: number;
  actionsAvailable: number;
  mandatoryTotal: number;
  priorityTotal: number;
  fundingAvailable: boolean;
};

export type SectorAnalysis = {
  totals: SectorTotals[];
  /** Sum over all sectors. */
  earnedTotal: number;
  availableTotal: number;
  unmapped: number;
  /** Sectors with zero activity — the blind spots. */
  untouched: SectorKey[];
  /** Highest-coverage sector with real activity. */
  strongest: SectorTotals | null;
  /**
   * How evenly effort is spread. 1.0 = perfectly even across all sectors,
   * 0 = everything in one. Computed with a normalised Shannon entropy so it
   * is comparable across communities that have done very different amounts.
   */
  spread: number;
};

export type CatalogueAction = {
  externalId: string;
  name: string;
  pointsMin: number | null;
  pointsMax: number | null;
  priority: boolean;
  mandatory: boolean;
  fundingEligible: boolean;
};

export type CompletedAction = {
  externalId: string;
  points: number | null;
};

/**
 * Build the per-sector breakdown.
 *
 * `available` uses points_max because that is the ceiling the programme
 * permits — using points_min would make a variable-point action look like it
 * were worth a fraction of its potential, and coverage would then exceed 1.0
 * for a community that maxed it out.
 */
export function analyseSectors(
  catalogue: CatalogueAction[],
  completed: CompletedAction[],
): SectorAnalysis {
  const acc = new Map<SectorKey, SectorTotals>();
  for (const k of SECTOR_KEYS) {
    acc.set(k, {
      sector: k,
      earned: 0,
      available: 0,
      coverage: 0,
      actionsDone: 0,
      actionsAvailable: 0,
      mandatoryTotal: 0,
      priorityTotal: 0,
      fundingAvailable: false,
    });
  }

  let unmapped = 0;
  const availableByAction = new Map<string, number>();

  for (const a of catalogue) {
    const s = sectorFor(a.externalId);
    if (!s) {
      unmapped += 1;
      continue;
    }
    const t = acc.get(s)!;
    const max = a.pointsMax ?? 0;
    t.available += max;
    t.actionsAvailable += 1;
    if (a.mandatory) t.mandatoryTotal += 1;
    if (a.priority) t.priorityTotal += 1;
    if (a.fundingEligible) t.fundingAvailable = true;
    availableByAction.set(a.externalId, max);
  }

  for (const c of completed) {
    const s = sectorFor(c.externalId);
    if (!s) continue;
    const t = acc.get(s)!;
    // Cap the award at the action's own ceiling: three communities had a
    // per-action award above points_max in the source data, and an uncapped sum
    // can push coverage past 1.0.
    const cap = availableByAction.get(c.externalId) ?? 0;
    t.earned += Math.min(c.points ?? 0, cap);
    t.actionsDone += 1;
  }

  const totals = SECTOR_KEYS.map((k) => {
    const t = acc.get(k)!;
    t.coverage = t.available > 0 ? t.earned / t.available : 0;
    return t;
  });

  const earnedTotal = totals.reduce((s, t) => s + t.earned, 0);
  const availableTotal = totals.reduce((s, t) => s + t.available, 0);

  const withActivity = totals.filter((t) => t.earned > 0);
  const strongest =
    withActivity.length > 0
      ? withActivity.reduce((a, b) => (b.coverage > a.coverage ? b : a))
      : null;

  // Normalised Shannon entropy over the EARNED distribution.
  // Dividing by ln(n) makes it comparable regardless of sector count.
  let spread = 0;
  if (earnedTotal > 0 && withActivity.length > 0) {
    const h = withActivity.reduce((acc2, t) => {
      const p = t.earned / earnedTotal;
      return acc2 - p * Math.log(p);
    }, 0);
    spread = h / Math.log(SECTOR_KEYS.length);
  }

  return {
    totals,
    earnedTotal,
    availableTotal,
    unmapped,
    untouched: totals.filter((t) => t.earned === 0).map((t) => t.sector),
    strongest,
    spread,
  };
}

/** Points of the polar chart. 12 o'clock = first sector, clockwise. */
export function polarPoint(
  index: number,
  count: number,
  radius: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}
