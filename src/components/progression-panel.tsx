"use client";

/**
 * Skill-tree progression panel for a community profile.
 *
 * The visual metaphor is deliberate: CSC certification is genuinely a
 * technology tree, not a points leaderboard. All four requirements must hold
 * simultaneously, so you cannot grind points alone — you need breadth
 * (distinct pledge elements) and prerequisites (mandatory + priority actions).
 * Civ's tech tree is the right mental model and this renders it as one.
 *
 * Everything numeric here comes from `csc-progression.ts`, which is validated
 * against all 185 certified communities by `scripts/validate-csc-rules.mjs`.
 * Do not compute thresholds inline in this file.
 */

import { useMemo, useState } from "react";
import {
  CSC_LEVELS,
  evaluateLevel,
  nearestUnmetGap,
  nextOfferedLevel,
  overallProgress,
  groupLabel,
  isPledgeElement,
  type ProgressSnapshot,
} from "@/lib/csc-progression";

export type ProgressionAction = {
  /** Group this action belongs to (PE1..PE10, or a named grouping). */
  group: string | null;
  name: string | null;
  rawName: string;
  points: number | null;
  /** Priority actions are prerequisites for levels, not just points. */
  priority: boolean;
  mandatory: boolean;
};

export type ProgressionCert = {
  level: number | null;
  levelName: string | null;
  pointsApproved: number | null;
  certifiedOn: string | null;
};

const LEVEL_COLORS: Record<string, { ring: string; bg: string; fg: string; dot: string }> = {
  bronze: { ring: "border-warn-line", bg: "bg-warn-soft", fg: "text-warn-ink", dot: "bg-warn-solid" },
  silver: { ring: "border-slate-400", bg: "bg-panel-muted", fg: "text-ink", dot: "bg-slate-400" },
  gold: { ring: "border-warn-line", bg: "bg-warn-soft", fg: "text-warn-ink", dot: "bg-warn-solid" },
  registered: { ring: "border-info-line", bg: "bg-info-soft", fg: "text-info-ink", dot: "bg-info-solid" },
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** SVG donut for requirement coverage. No chart library needed. */
function ProgressRing({
  progress,
  size = 92,
  stroke = 9,
  label,
  sub,
  reached,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  label: string;
  sub: string;
  reached: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const dash = c * clamped;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${label}: ${pct(clamped)}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className={reached ? "text-ok-solid" : "text-info-solid"}
        />
      </svg>
      <div className="-mt-[62px] text-center">
        <div className="text-lg font-semibold tabular-nums">{pct(clamped)}</div>
      </div>
      <div className="mt-[30px] text-center">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-ink-muted">{sub}</div>
      </div>
    </div>
  );
}

/** Horizontal bar with a threshold marker. */
function ThresholdBar({
  value,
  need,
  max,
}: {
  value: number;
  need: number;
  max: number;
}) {
  const v = Math.max(0, Math.min(1, value / max));
  const t = Math.max(0, Math.min(1, need / max));
  const met = value >= need;
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className={`h-full rounded-full ${met ? "bg-ok-solid" : "bg-info-solid"}`}
        style={{ width: `${v * 100}%` }}
      />
      {/* threshold tick — the "you need to reach this" line */}
      <div
        className="absolute top-0 h-full w-0.5 bg-ink/70"
        style={{ left: `calc(${t * 100}% - 1px)` }}
        aria-hidden
      />
    </div>
  );
}

export default function ProgressionPanel({
  actions,
  cert,
}: {
  actions: ProgressionAction[];
  cert: ProgressionCert | null;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const derived = useMemo(() => {
    // Group completions. `group` comes from the joined actions row; unmatched
    // completions have no group and are surfaced separately rather than being
    // silently dropped into a misc bucket.
    const byGroup = new Map<string, ProgressionAction[]>();
    let unmatched = 0;
    for (const a of actions) {
      if (!a.group) {
        unmatched += 1;
        continue;
      }
      const list = byGroup.get(a.group) ?? [];
      list.push(a);
      byGroup.set(a.group, list);
    }

    const groups = [...byGroup.entries()].map(([group, list]) => ({
      group,
      label: groupLabel(group),
      isPledgeElement: isPledgeElement(group),
      earned: list.reduce((s, a) => s + (a.points ?? 0), 0),
      completedCount: list.length,
      mandatoryDone: list.filter((a) => a.mandatory).length,
      priorityDone: list.filter((a) => a.priority).length,
    }));

    groups.sort((a, b) => {
      // Pledge elements first (in numeric order), then named groups by points.
      if (a.isPledgeElement !== b.isPledgeElement) return a.isPledgeElement ? -1 : 1;
      if (a.isPledgeElement && b.isPledgeElement) return a.group.localeCompare(b.group, undefined, { numeric: true });
      return b.earned - a.earned;
    });

    const computedPoints = actions.reduce((s, a) => s + (a.points ?? 0), 0);

    // AUTHORITATIVE POINTS — see scripts/validate-csc-rules.mjs.
    // For a certified community `pointsApproved` is the official total and wins
    // over our per-action sum (they agree for 183/185; the 3 exceptions differ
    // by small negative amounts, likely partial-credit rounding upstream).
    // For an uncertified community no approved figure exists, so the sum is
    // the only option — and it is labelled as an estimate in the UI.
    const approved = cert?.pointsApproved ?? 0;
    const usingApproved = approved > 0;
    const points = usingApproved ? approved : computedPoints;

    const snapshot: ProgressSnapshot = {
      points,
      pledgeElementsCovered: groups.filter((g) => g.isPledgeElement).length,
      mandatoryDone: actions.filter((a) => a.mandatory).length,
      priorityDone: actions.filter((a) => a.priority).length,
    };

    return { groups, snapshot, computedPoints, usingApproved, unmatched, points };
  }, [actions, cert]);

  const { groups, snapshot, computedPoints, usingApproved, unmatched } = derived;

  // Level statuses for every offered level, plus the unreachable Gold.
  const statuses = CSC_LEVELS.map((l) => evaluateLevel(l, snapshot));
  const next = nextOfferedLevel(snapshot);
  const nearest = next ? nearestUnmetGap(next.status) : null;

  const currentLevelKey =
    [...statuses].reverse().find((s) => s.reached && s.offered)?.level.key ?? "registered";

  return (
    <section className="rounded-xl border border-line bg-panel p-6">
      <header className="mb-5">
        <h2 className="text-lg font-semibold">Certification path</h2>
        <p className="mt-1 text-sm text-ink-muted">
          CSC certification is a tech tree, not a scoreboard: every level needs{" "}
          <strong>points</strong>, <strong>breadth</strong> (distinct pledge
          elements), and <strong>prerequisites</strong> (mandatory and priority
          actions) at the same time.
        </p>
      </header>

      {/* ---------------- level ladder ---------------- */}
      <ol className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statuses.map((s) => {
          const colors = LEVEL_COLORS[s.level.key] ?? LEVEL_COLORS.registered;
          const isCurrent = s.level.key === currentLevelKey;
          return (
            <li
              key={s.level.key}
              className={`rounded-lg border-2 p-4 ${
                isCurrent ? `${colors.ring} ${colors.bg}` : "border-line bg-panel"
              } ${!s.offered ? "opacity-70" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold ${colors.fg}`}>{s.level.name}</span>
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${colors.dot}`}
                  aria-hidden
                />
              </div>

              {!s.offered ? (
                <p className="mt-2 text-[11px] leading-snug text-ink-muted">
                  {s.level.note ?? "Not currently offered."}
                </p>
              ) : (
                <>
                  <div className="mt-3 flex justify-center">
                    <ProgressRing
                      progress={overallProgress(s)}
                      size={86}
                      label={s.reached ? "Achieved" : "Requirements met"}
                      sub={
                        s.reached
                          ? "level reached"
                          : s.pointsShort > 0
                            ? `${s.pointsShort} pts to go`
                            : "points met"
                      }
                      reached={s.reached}
                    />
                  </div>
                  <ul className="mt-2 space-y-1">
                    {s.gaps.map((g) => (
                      <li key={g.label} className="flex items-center justify-between text-[11px]">
                        <span className={g.met ? "text-ink-muted" : "text-ink"}>
                          {g.met ? "✓" : "•"} {g.label}
                        </span>
                        <span
                          className={`tabular-nums ${g.met ? "text-ok-solid" : "text-ink-muted"}`}
                        >
                          {g.have}
                          <span className="text-ink-subtle">/{g.need}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </li>
          );
        })}
      </ol>

      {/* ---------------- what next ---------------- */}
      {next && nearest && (
        <div className="mb-6 rounded-lg border border-info-line bg-info-soft p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-info-ink">
                Next unlock: {next.status.level.name}
              </h3>
              <p className="mt-1 text-sm text-info-ink">
                Closest unmet requirement is{" "}
                <strong>{nearest.gap.label}</strong> — currently{" "}
                <strong className="tabular-nums">
                  {nearest.gap.have} of {nearest.gap.need}
                </strong>{" "}
                ({pct(nearest.progress)} of the way there).
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-panel px-3 py-1 text-xs font-semibold text-info-ink tabular-nums">
              {pct(overallProgress(next.status))} ready
            </span>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {next.status.gaps
              .filter((g) => !g.met && g.need > 0)
              .map((g) => (
                <li key={g.label} className="rounded-md bg-panel/70 px-3 py-2">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-medium text-ink-muted">{g.label}</span>
                    <span className="tabular-nums text-ink-muted">
                      {g.have}/{g.need}
                    </span>
                  </div>
                  <ThresholdBar value={g.have} need={g.need} max={g.need} />
                </li>
              ))}
          </ul>
        </div>
      )}
      {!next && (
        <div className="mb-6 rounded-lg border border-ok-line bg-ok-soft p-4 text-sm text-ok-ink">
          <strong>All currently-offered levels reached.</strong> Gold is not yet
          offered by NYSDEC, so there is no further tier to progress toward.
        </div>
      )}

      {/* ---------------- points provenance ---------------- */}
      <div className="mb-6 rounded-lg border border-line bg-panel-muted px-4 py-3 text-xs text-ink-muted">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            <strong className="text-ink tabular-nums">{derived.points}</strong>{" "}
            points {usingApproved ? "(approved by NYSDEC)" : "(estimated from completed actions)"}
          </span>
          {usingApproved && computedPoints !== derived.points && (
            <span className="text-ink-muted">
              our per-action sum is {computedPoints} — approved figure takes precedence
            </span>
          )}
        </div>
        {!usingApproved && (
          <p className="mt-1 text-ink-muted">
            Not yet certified, so no approved total exists. The figure above is
            the sum of documented actions and may differ from a future NYSDEC
            determination.
          </p>
        )}
        {unmatched > 0 && (
          <p className="mt-1 text-warn-ink">
            {unmatched} completed action{unmatched === 1 ? "" : "s"} could not be
            matched to a catalogue entry and {unmatched === 1 ? "is" : "are"} not
            counted above.
          </p>
        )}
      </div>

      {/* ---------------- the tree ---------------- */}
      <div>
        <h3 className="mb-1 text-sm font-semibold">Branches explored</h3>
        <p className="mb-3 text-xs text-ink-muted">
          {snapshot.pledgeElementsCovered} of 10 pledge elements covered ·{" "}
          {groups.length} branches total. Click a branch to list its actions.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {groups.map((g) => {
            const open = openGroup === g.group;
            const pledge = g.isPledgeElement;
            return (
              <li key={g.group} className="rounded-lg border border-line">
                <button
                  type="button"
                  onClick={() => setOpenGroup(open ? null : g.group)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-panel-muted"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      pledge ? "bg-info-soft-strong text-info-ink" : "bg-panel-muted text-info-ink"
                    }`}
                  >
                    {g.group}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink">
                      {g.label}
                    </span>
                    <span className="block text-[11px] text-ink-muted">
                      {g.completedCount} action{g.completedCount === 1 ? "" : "s"}
                      {g.mandatoryDone > 0 && ` · ${g.mandatoryDone} mandatory`}
                      {g.priorityDone > 0 && ` · ${g.priorityDone} priority`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted">
                    {g.earned}
                    <span className="font-normal text-ink-subtle"> pts</span>
                  </span>
                </button>
                {open && (
                  <ul className="border-t border-line px-3 py-2">
                    {actions
                      .filter((a) => a.group === g.group)
                      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
                      .map((a, i) => (
                        <li
                          key={`${a.rawName}-${i}`}
                          className="flex items-start justify-between gap-3 py-1.5 text-[11px]"
                        >
                          <span className="min-w-0 flex-1 text-ink-muted">
                            {a.name ?? a.rawName}
                            {a.mandatory && (
                              <span className="ml-1.5 rounded bg-crit-soft-strong px-1 py-0.5 text-[9px] font-semibold text-crit-ink">
                                MANDATORY
                              </span>
                            )}
                            {a.priority && (
                              <span className="ml-1.5 rounded bg-flag-soft-strong px-1 py-0.5 text-[9px] font-semibold text-flag-ink">
                                PRIORITY
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 tabular-nums text-ink-muted">
                            {a.points ?? "—"}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
