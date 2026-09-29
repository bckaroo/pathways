"use client";

/**
 * Sector radial — which emissions sectors a community is working on.
 *
 * DESIGN NOTES
 * ------------
 * A radar/spider chart was the obvious choice and is what this looks like, but
 * the axes are NOT independent scales. Two things follow from that:
 *
 *  1. Two rings, never one. The outer ring is what the CSC programme offers in
 *     each sector (fixed at 124 actions / 1,229 points), the inner polygon is
 *     what the community has done. One ring alone would make "8 of 8 water
 *     actions" look like a bigger achievement than "22 of 22 building actions",
 *     when both are simply the whole sector.
 *
 *  2. Coverage is the meaningful measure, not raw points. A sector with few
 *     available actions saturates at a low point total. The polygon plots
 *     COVERAGE of each sector (earned / available), so every spoke is on the
 *     same 0–100% scale and the shape is honest.
 *
 * Governance & Planning and Adaptation & Resilience are included but are not
 * emitting sectors — they are shown because they are where a large share of CSC
 * effort goes, and hiding them would misrepresent the programme. They are
 * visually distinguished.
 */

import { useMemo, useState } from "react";
import {
  analyseSectors,
  SECTORS,
  type CatalogueAction,
  type CompletedAction,
  type SectorKey,
} from "@/lib/csc-sectors";

const SIZE = 460;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUTER = 168;
const R_LABEL = 205;

function polar(i: number, n: number, r: number) {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

function ringPath(n: number, r: number): string {
  const pts = Array.from({ length: n }, (_, i) => polar(i, n, r));
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") + " Z";
}

/** Text anchor + baseline so labels sit outside the ring without overlapping. */
function labelPlacement(i: number, n: number) {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let anchor: "start" | "middle" | "end" = "middle";
  if (cos > 0.25) anchor = "start";
  else if (cos < -0.25) anchor = "end";
  let baseline: "middle" | "auto" | "hanging" = "middle";
  if (sin < -0.85) baseline = "auto";
  else if (sin > 0.85) baseline = "hanging";
  return { anchor, baseline };
}

export default function SectorRadial({
  catalogue,
  completed,
}: {
  catalogue: CatalogueAction[];
  completed: CompletedAction[];
}) {
  const [hovered, setHovered] = useState<SectorKey | null>(null);

  const analysis = useMemo(
    () => analyseSectors(catalogue, completed),
    [catalogue, completed],
  );

  const n = analysis.totals.length;
  const gridLevels = [0.25, 0.5, 0.75, 1];

  // Polygon of the community's coverage.
  const polyPoints = analysis.totals
    .map((t, i) => polar(i, n, Math.max(t.coverage, 0.012) * R_OUTER))
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");

  const topSectors = [...analysis.totals].sort((a, b) => b.earned - a.earned);
  const active = topSectors.filter((t) => t.earned > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Emissions sectors addressed</h2>
        <p className="mt-1 text-sm text-slate-600">
          Which sectors this community&rsquo;s CSC actions actually work on.
          Each spoke is <strong>coverage of that sector</strong> — points earned
          as a share of the points the programme makes available — so every axis
          is on the same 0–100% scale.
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ---------------- radial ---------------- */}
        <div className="shrink-0 self-center">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width="100%"
            style={{ maxWidth: SIZE }}
            role="img"
            aria-label={`Sector coverage radial. ${analysis.totals
              .map((t) => `${SECTORS[t.sector].label} ${Math.round(t.coverage * 100)}%`)
              .join(", ")}.`}
          >
            {/* grid rings */}
            {gridLevels.map((lv) => (
              <polygon
                key={lv}
                points={ringPath(n, lv * R_OUTER)
                  .replace(/[ML]/g, "")
                  .trim()
                  .split(" ")
                  .map((pair) => pair)
                  .join(" ")}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth={1}
              />
            ))}

            {/* spokes */}
            {analysis.totals.map((t, i) => {
              const p = polar(i, n, R_OUTER);
              return (
                <line
                  key={t.sector}
                  x1={CX}
                  y1={CY}
                  x2={p.x}
                  y2={p.y}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
              );
            })}

            {/* 50% reference — the "half the available actions" mark */}
            <polygon
              points={Array.from({ length: n }, (_, i) => polar(i, n, 0.5 * R_OUTER))
                .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
                .join(" ")}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={1}
              strokeDasharray="4 4"
            />

            {/* the community's coverage polygon */}
            <polygon
              points={polyPoints}
              fill="rgba(37,99,235,0.18)"
              stroke="#2563eb"
              strokeWidth={2}
              strokeLinejoin="round"
            />

            {/* vertices, sized by whether the sector has been touched at all */}
            {analysis.totals.map((t, i) => {
              const p = polar(i, n, Math.max(t.coverage, 0.012) * R_OUTER);
              const hot = hovered === t.sector;
              return (
                <circle
                  key={t.sector}
                  cx={p.x}
                  cy={p.y}
                  r={t.earned > 0 ? (hot ? 7 : 4.5) : 3}
                  fill={t.earned > 0 ? SECTORS[t.sector].color : "#ffffff"}
                  stroke={t.earned > 0 ? "#ffffff" : "#94a3b8"}
                  strokeWidth={2}
                />
              );
            })}

            {/* labels */}
            {analysis.totals.map((t, i) => {
              const p = polar(i, n, R_LABEL);
              const { anchor, baseline } = labelPlacement(i, n);
              const pct = Math.round(t.coverage * 100);
              const untouched = t.earned === 0;
              return (
                <g key={`lab-${t.sector}`}>
                  <text
                    x={p.x}
                    y={p.y - 7}
                    textAnchor={anchor}
                    dominantBaseline={baseline}
                    className="fill-slate-700"
                    style={{ fontSize: 12, fontWeight: 600 }}
                  >
                    {SECTORS[t.sector].short}
                  </text>
                  <text
                    x={p.x}
                    y={p.y + 8}
                    textAnchor={anchor}
                    dominantBaseline={baseline}
                    className={untouched ? "fill-slate-400" : "fill-slate-500"}
                    style={{ fontSize: 11 }}
                  >
                    {untouched ? "none" : `${pct}%`}
                  </text>
                </g>
              );
            })}

            <text
              x={CX}
              y={CY - 6}
              textAnchor="middle"
              className="fill-slate-800"
              style={{ fontSize: 20, fontWeight: 700 }}
            >
              {analysis.earnedTotal}
            </text>
            <text
              x={CX}
              y={CY + 12}
              textAnchor="middle"
              className="fill-slate-500"
              style={{ fontSize: 11 }}
            >
              of {analysis.availableTotal} pts
            </text>
          </svg>
        </div>

        {/* ---------------- side readout ---------------- */}
        <div className="min-w-0 flex-1">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Sectors touched
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {active.length}
                <span className="text-sm font-normal text-slate-400">
                  /{analysis.totals.length}
                </span>
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Effort balance
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {(analysis.spread * 100).toFixed(0)}
                <span className="text-sm font-normal text-slate-400">/100</span>
              </div>
            </div>
          </div>

          <ul className="space-y-2">
            {topSectors.map((t) => {
              const s = SECTORS[t.sector];
              const pct = Math.round(t.coverage * 100);
              const dim = hovered !== null && hovered !== t.sector;
              return (
                <li
                  key={t.sector}
                  onMouseEnter={() => setHovered(t.sector)}
                  onMouseLeave={() => setHovered(null)}
                  className={`rounded-md px-2 py-1.5 transition-opacity ${
                    dim ? "opacity-40" : ""
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                      <span className="truncate font-medium text-slate-700">
                        {s.label}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-600">
                      <strong className="text-slate-800">{t.earned}</strong>
                      <span className="text-slate-400">/{t.available}</span>
                      <span className="ml-2 inline-block w-9 text-right">{pct}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: s.color }}
                    />
                  </div>
                  <div className="mt-0.5 flex gap-3 text-[10px] text-slate-500">
                    <span>
                      {t.actionsDone}/{t.actionsAvailable} actions
                    </span>
                    {t.priorityTotal > 0 && <span>{t.priorityTotal} priority available</span>}
                    {t.fundingAvailable && <span className="text-emerald-600">grant-eligible</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* ---------------- gaps ---------------- */}
      {analysis.untouched.length > 0 && (
        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="text-sm font-medium text-amber-900">
            {analysis.untouched.length === 1
              ? "One sector has no action at all"
              : `${analysis.untouched.length} sectors have no action at all`}
          </div>
          <p className="mt-1 text-xs text-amber-900">
            {analysis.untouched.map((k) => SECTORS[k].label).join(" · ")}
          </p>
        </div>
      )}

      {/* ---------------- provenance ---------------- */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <p>
          Sector assignment is <strong>curated per action</strong>, not derived
          from pledge element — PE3 contains both fleet and building actions, and
          PE6 contains EV charging and transit. Using pledge element as the
          sector would misattribute them. All {catalogue.length} actions are
          mapped; see <code>src/lib/csc-sectors.json</code>.
        </p>
        <p className="mt-1 text-slate-500">
          Governance &amp; Planning and Adaptation &amp; Resilience are included
          for completeness but are not emitting sectors.
          {analysis.unmapped > 0 && (
            <span className="text-amber-700">
              {" "}
              {analysis.unmapped} action{analysis.unmapped === 1 ? "" : "s"} could
              not be mapped and {analysis.unmapped === 1 ? "is" : "are"} excluded.
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
