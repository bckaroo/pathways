"use client";

/**
 * Community index table (DEV-151 v1 dashboard): client-side search + filters
 * over the full municipality dataset rendered server-side.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

export type CommunityRow = {
  uid: number;
  name: string;
  areaType: string | null;
  county: string | null;
  cscLabel: string | null;
  cecLabel: string | null;
  cecStars: number;
};

const TYPES = ["city", "town", "village", "county"] as const;

function cscBadgeClass(label: string): string {
  if (label === "Gold") return "bg-warn-soft-strong text-warn-ink ring-warn-line";
  if (label === "Silver") return "bg-panel-muted text-ink-muted ring-line-strong";
  if (label === "Bronze") return "bg-warn-soft-strong text-warn-ink ring-warn-line";
  return "bg-info-soft-strong text-info-ink ring-info-line"; // Registered
}

export default function CommunityTable({ rows }: { rows: CommunityRow[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const [cecFilter, setCecFilter] = useState<string>("all");
  const [certifiedOnly, setCertifiedOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(`${r.name} ${r.county ?? ""}`.toLowerCase().includes(q))) return false;
      if (type !== "all" && r.areaType !== type) return false;
      if (certifiedOnly && !(r.cscLabel === "Bronze" || r.cscLabel === "Silver" || r.cscLabel === "Gold")) return false;
      if (cecFilter === "designated" && r.cecLabel !== "Designated") return false;
      if (cecFilter === "starred" && r.cecStars < 1) return false;
      return true;
    });
  }, [rows, query, type, cecFilter, certifiedOnly]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or county…"
          className="w-64 rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm shadow-sm focus:border-ok-line focus:outline-none"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm shadow-sm"
          aria-label="Filter by municipality type"
        >
          <option value="all">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={cecFilter}
          onChange={(e) => setCecFilter(e.target.value)}
          className="rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm shadow-sm"
          aria-label="Filter by CEC status"
        >
          <option value="all">CEC: any</option>
          <option value="designated">CEC: designated</option>
          <option value="starred">CEC: ★ 1–5</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={certifiedOnly}
            onChange={(e) => setCertifiedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong"
          />
          Certified only
        </label>
        <span className="ml-auto text-sm text-ink-muted">
          Showing {filtered.length.toLocaleString("en-US")} of{" "}
          {rows.length.toLocaleString("en-US")}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-panel shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-2.5 font-medium">Community</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">County</th>
              <th className="px-4 py-2.5 font-medium">CSC</th>
              <th className="px-4 py-2.5 font-medium">CEC</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.uid} className="border-b border-line last:border-0 hover:bg-panel-muted">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/communities/${r.uid}`} className="text-ok-ink hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 capitalize text-ink-muted">{r.areaType ?? "—"}</td>
                <td className="px-4 py-2 text-ink-muted">{r.county ?? "—"}</td>
                <td className="px-4 py-2">
                  {r.cscLabel ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cscBadgeClass(r.cscLabel)}`}
                    >
                      {r.cscLabel}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {r.cecLabel ? (
                    <span className="inline-block rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok-ink ring-1 ring-ok-line">
                      {r.cecLabel}
                      {r.cecStars > 0 ? ` ${"★".repeat(r.cecStars)}` : ""}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                  No communities match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}