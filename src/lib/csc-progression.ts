/**
 * CSC progression model — the "skill tree" domain logic.
 *
 * Kept separate from the UI so the rules can be unit-tested and reused (map
 * tooltips, list sorting, export). Nothing here touches React.
 *
 * SOURCES AND WHY THEY MATTER
 * ---------------------------
 * Thresholds are NOT in our database: `certification_levels.points_required`
 * is NULL for all three rows. They were taken from NYSDEC's published
 * Certification Levels page, and cross-checked against our own certified
 * communities:
 *
 *   Bronze  120 pts, 4 PEs, 2 mandatory, 3 priority
 *   Silver  300 pts, 7 PEs, 2 mandatory, 6 priority
 *   Gold    DOES NOT EXIST — NYSDEC states it is "currently under development"
 *
 * The observed Bronze floor in our data is exactly 120 and the Silver floor is
 * 305, which corroborates the website. NYSERDA's older Certification Manual
 * PDF lists 250/350 for silver/gold; that document is stale and must NOT be
 * used. This is a case where two official-looking sources disagree and only
 * one matches the data.
 *
 * Gold is deliberately modelled as unreachable rather than given an invented
 * threshold. Zero communities have achieved it because the level is not yet
 * offered — that is a fact about the program, not about the communities, and
 * showing a progress bar toward it would be a lie.
 */

export const CSC_PLEDGE_ELEMENTS: Record<string, string> = {
  PE1: "Build a climate-smart community",
  PE2: "Inventory emissions, set goals, plan for climate action",
  PE3: "Decrease energy use",
  PE4: "Shift to clean, renewable energy",
  PE5: "Use climate-smart materials management",
  PE6: "Implement climate-smart land use",
  PE7: "Enhance community resilience",
  PE8: "Support a green innovation economy",
  PE9: "Inform and inspire the public",
  PE10: "Engage in an evolving process of climate action",
};

/** Non-PE groupings present in the actions table. */
export const CSC_NON_PE_GROUP_LABELS: Record<string, string> = {
  Performance: "Performance",
  Innovation: "Innovation",
  Planning: "Planning",
  Benchmarking: "Benchmarking",
  "Clean Energy Upgrades": "Clean Energy Upgrades",
  "Unified Solar Permit": "Unified Solar Permit",
  "NYStretch Energy Code": "NYStretch Energy Code",
  "Clean Heating and Cooling Demo": "Clean Heating & Cooling Demo",
  "Community Engagement and Training": "Community Engagement & Training",
  "Clean Fleets": "Clean Fleets",
  "LED Street Lights": "LED Street Lights",
  "Buildings and Facilities": "Buildings & Facilities",
  "Transportation and Landscaping": "Transportation & Landscaping",
  "Community Choice Aggregation": "Community Choice Aggregation",
  "Community Campaigns": "Community Campaigns",
  "PACE Financing": "PACE Financing",
  "Climate Smart Communities Certification": "CSC Certification",
  "Legislation and Regulation": "Legislation & Regulation",
  "County Hosted Training": "County-Hosted Training",
  "Energy Code Enforcement Training": "Energy Code Enforcement Training",
  "100% Renewable Electricity": "100% Renewable Electricity",
  "HIA": "CEC High-Impact Actions",
};

export function groupLabel(group: string): string {
  return (
    CSC_PLEDGE_ELEMENTS[group] ??
    CSC_NON_PE_GROUP_LABELS[group] ??
    group
  );
}

/** Pledge elements carry a number; other groupings do not. */
export function isPledgeElement(group: string): boolean {
  return /^PE\d+$/.test(group);
}

export type LevelKey = "registered" | "bronze" | "silver" | "gold";

export type LevelRequirement = {
  key: LevelKey;
  name: string;
  points: number;
  pledgeElements: number;
  mandatory: number;
  priority: number;
  /** Null when the level is not yet offered by the program. */
  offered: boolean;
  note?: string;
};

export const CSC_LEVELS: LevelRequirement[] = [
  {
    key: "registered",
    name: "Registered",
    points: 0,
    pledgeElements: 0,
    mandatory: 0,
    priority: 0,
    offered: true,
    note: "Signed the CSC pledge. No point threshold.",
  },
  {
    key: "bronze",
    name: "Bronze",
    points: 120,
    pledgeElements: 4,
    mandatory: 2,
    priority: 3,
    offered: true,
  },
  {
    key: "silver",
    name: "Silver",
    points: 300,
    pledgeElements: 7,
    mandatory: 2,
    priority: 6,
    offered: true,
  },
  {
    key: "gold",
    name: "Gold",
    points: 0,
    pledgeElements: 0,
    mandatory: 0,
    priority: 0,
    offered: false,
    note:
      "Gold is not yet offered — NYSDEC lists it as under development. " +
      "No threshold exists, so no progress can be shown toward it.",
  },
];

export type ActionState = "done" | "available" | "blocked";

export type TreeNode = {
  group: string;
  label: string;
  isPledgeElement: boolean;
  /** Points the community has already earned in this group. */
  earned: number;
  /** Points still obtainable in this group. */
  obtainable: number;
  completedCount: number;
  totalCount: number;
  mandatoryTotal: number;
  mandatoryDone: number;
  priorityTotal: number;
  priorityDone: number;
};

export type ProgressSnapshot = {
  points: number;
  pledgeElementsCovered: number;
  mandatoryDone: number;
  priorityDone: number;
};

export type RequirementGap = {
  label: string;
  have: number;
  need: number;
  met: boolean;
};

export type LevelStatus = {
  level: LevelRequirement;
  reached: boolean;
  offered: boolean;
  gaps: RequirementGap[];
  /** Points still needed for this level specifically. */
  pointsShort: number;
};

/**
 * Evaluate the four independent requirements for a level.
 *
 * All four must hold. This is the "Civ" part: you cannot reach a level by
 * grinding points alone — you also need breadth (distinct pledge elements) and
 * prerequisites (mandatory + priority actions).
 */
export function evaluateLevel(
  level: LevelRequirement,
  snap: ProgressSnapshot,
): LevelStatus {
  const gaps: RequirementGap[] = [
    {
      label: "Points",
      have: snap.points,
      need: level.points,
      met: snap.points >= level.points,
    },
    {
      label: "Pledge elements",
      have: snap.pledgeElementsCovered,
      need: level.pledgeElements,
      met: snap.pledgeElementsCovered >= level.pledgeElements,
    },
    {
      label: "Mandatory actions",
      have: snap.mandatoryDone,
      need: level.mandatory,
      met: snap.mandatoryDone >= level.mandatory,
    },
    {
      label: "Priority actions",
      have: snap.priorityDone,
      need: level.priority,
      met: snap.priorityDone >= level.priority,
    },
  ];

  return {
    level,
    reached: level.offered && gaps.every((g) => g.met),
    offered: level.offered,
    gaps,
    pointsShort: Math.max(0, level.points - snap.points),
  };
}

/** The next level the community has not yet reached and could still reach. */
export function nextOfferedLevel(
  snap: ProgressSnapshot,
): { status: LevelStatus; index: number } | null {
  const statuses = CSC_LEVELS.filter((l) => l.offered).map((l) =>
    evaluateLevel(l, snap),
  );
  for (let i = 0; i < statuses.length; i++) {
    if (!statuses[i].reached) return { status: statuses[i], index: i };
  }
  return null;
}

/**
 * Which unmet requirement is closest to completion?
 *
 * This drives the "what next" recommendation. Returned as a ratio so ties are
 * broken by whatever is genuinely nearest, not by arbitrary ordering.
 */
export function nearestUnmetGap(
  status: LevelStatus,
): { gap: RequirementGap; progress: number } | null {
  const unmet = status.gaps.filter((g) => !g.met && g.need > 0);
  if (!unmet.length) return null;
  let best = unmet[0];
  let bestRatio = best.have / best.need;
  for (const g of unmet.slice(1)) {
    const ratio = g.have / g.need;
    if (ratio > bestRatio) {
      best = g;
      bestRatio = ratio;
    }
  }
  return { gap: best, progress: bestRatio };
}

/**
 * Requirement coverage as a 0..1 fraction, averaged across the four criteria.
 *
 * Used for the progress ring. Deliberately NOT the points ratio alone: a
 * community at 400 points but only 3 pledge elements is not "93% of Silver",
 * and showing that would mislead.
 */
export function overallProgress(status: LevelStatus): number {
  const parts = status.gaps
    .filter((g) => g.need > 0)
    .map((g) => Math.min(1, g.have / g.need));
  if (!parts.length) return 1;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}
