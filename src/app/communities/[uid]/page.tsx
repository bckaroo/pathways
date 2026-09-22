import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import {
  actions,
  cecCompletions,
  cecDesignations,
  certifications,
  completions,
  municipalities,
} from "@/db/schema";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Community profile — Pathways",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function parseStars(stars: string | null | undefined): number {
  const n = Number.parseInt((stars ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

const BADGES: Record<string, string> = {
  Gold: "bg-yellow-100 text-yellow-800 ring-yellow-300",
  Silver: "bg-slate-100 text-slate-600 ring-slate-300",
  Bronze: "bg-amber-100 text-amber-800 ring-amber-300",
  Registered: "bg-blue-100 text-blue-700 ring-blue-300",
};

function levelBadgeLabel(level: number | null, levelName: string | null): string {
  return levelName ?? (level != null ? "Registered" : "Not registered");
}

export default async function CommunityProfilePage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid: uidRaw } = await params;
  const uid = Number.parseInt(uidRaw, 10);
  if (!Number.isFinite(uid)) notFound();

  let base;
  try {
    const found = await db
      .select()
      .from(municipalities)
      .where(eq(municipalities.portalUid, uid));
    base = found[0];
  } catch {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
          Database not reachable. Start it with{" "}
          <code className="rounded bg-amber-100 px-1">docker compose up -d</code>{" "}
          and reload.
        </div>
      </main>
    );
  }
  if (!base) notFound();

  const [certRows, cscRows, cecRowRows, cecActionRows] = await Promise.all([
    db
      .select()
      .from(certifications)
      .where(eq(certifications.municipalityUid, uid))
      .orderBy(desc(certifications.certifiedOn)),
    db
      .select({
        raw: completions.rawActionName,
        unmatched: completions.actionExternalId,
        points: completions.pointsAwarded,
        certifiedOn: certifications.certifiedOn,
        certName: certifications.name,
        actionName: actions.name,
      })
      .from(completions)
      .innerJoin(certifications, eq(completions.certificationUid, certifications.certUid))
      .leftJoin(
        actions,
        and(eq(actions.programSlug, "csc"), eq(actions.externalId, completions.actionExternalId)),
      )
      .where(eq(completions.municipalityUid, uid))
      .orderBy(desc(certifications.certifiedOn), asc(completions.rawActionName)),
    db
      .select()
      .from(cecDesignations)
      .where(eq(cecDesignations.municipalityUid, uid)),
    db
      .select({
        raw: cecCompletions.rawActionName,
        category: cecCompletions.parentCategory,
        points: cecCompletions.pointsApproved,
        completedOn: cecCompletions.completedOn,
        actionName: actions.name,
      })
      .from(cecCompletions)
      .leftJoin(
        actions,
        and(eq(actions.programSlug, "cec"), eq(actions.externalId, cecCompletions.actionExternalId)),
      )
      .where(eq(cecCompletions.municipalityUid, uid))
      .orderBy(desc(cecCompletions.completedOn), asc(cecCompletions.rawActionName)),
  ]);

  const cert = certRows[0] ?? null;
  const cec = cecRowRows[0] ?? null;
  const stars = parseStars(cec?.advancedDesignation ?? null);
  const cscBadge = levelBadgeLabel(
    cert?.level ?? base.certificationLevel ?? (base.portalUid > 0 ? 0 : null),
    cert?.levelName ?? base.certificationLevelName ?? null,
  );
  const cscPoints = cert?.pointsApproved ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-4 text-sm text-neutral-500">
        <Link href="/communities" className="hover:underline">
          ← Communities
        </Link>
        <span className="mx-2">·</span>
        <Link href="/map" className="hover:underline">
          Statewide map
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{base.name}</h1>
        <p className="mt-1 text-neutral-600">
          {base.areaType ? base.areaType[0].toUpperCase() + base.areaType.slice(1) : "Municipality"}
          {base.county ? ` · ${base.county} County` : ""}
          {cec?.region ? ` · ${cec.region} region` : ""}
          {base.latitude != null && base.longitude != null
            ? ` · ${base.latitude.toFixed(3)}, ${base.longitude.toFixed(3)}`
            : ""}
        </p>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* CSC certification card */}
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Climate Smart Communities (CSC)
          </h2>
          <div className="flex items-baseline gap-3">
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
                BADGES[cscBadge] ?? "bg-neutral-100 text-neutral-600 ring-neutral-300"
              }`}
            >
              {cscBadge}
            </span>
            {cscPoints != null && (
              <span className="text-2xl font-bold tabular-nums">{cscPoints} pts</span>
            )}
          </div>
          {cert ? (
            <dl className="mt-3 space-y-1 text-sm text-neutral-600">
              <div>
                <dt className="inline font-medium text-neutral-800">Certified: </dt>
                <dd className="inline">{formatDate(cert.certifiedOn)}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-neutral-800">Report: </dt>
                <dd className="inline">
                  {cert.reportUrl ? (
                    <a
                      href={cert.reportUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-700 hover:underline"
                    >
                      {cert.name}
                    </a>
                  ) : (
                    cert.name
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-neutral-800">Completed actions: </dt>
                <dd className="inline">{cscRows.length.toLocaleString("en-US")}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-neutral-500">
              {base.portalUid > 0
                ? "Registered in the CSC program; no certification report on file yet."
                : "Tracked by CEC only; no CSC participation on record."}
            </p>
          )}
        </div>

        {/* CEC designation card */}
        <div className="rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Clean Energy Communities (CEC)
          </h2>
          {cec ? (
            <>
              <div className="flex items-baseline gap-3">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
                    cec.status === "Designated CEC"
                      ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
                      : "bg-neutral-100 text-neutral-600 ring-neutral-300"
                  }`}
                >
                  {cec.status === "Designated CEC" ? "Designated" : "Not designated"}
                </span>
                {stars > 0 && (
                  <span className="text-2xl font-bold text-emerald-700">
                    {"★".repeat(stars)}
                  </span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-600">
                <div>
                  <dt className="inline font-medium text-neutral-800">HIAs approved: </dt>
                  <dd className="inline">{cec.hiasApproved ?? 0}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-neutral-800">Points: </dt>
                  <dd className="inline">{cec.pointsAchievedTotal ?? 0}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-neutral-800">Population: </dt>
                  <dd className="inline">
                    {cec.population != null ? cec.population.toLocaleString("en-US") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium text-neutral-800">Size: </dt>
                  <dd className="inline">{cec.communitySize ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-neutral-800">Last HIA: </dt>
                  <dd className="inline">{formatDate(cec.latestActionApprovedOn)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-neutral-800">Actions: </dt>
                  <dd className="inline">{cecActionRows.length.toLocaleString("en-US")}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-neutral-400">
                CEC program closed; designation and star data are historical
                (NYSERDA, frozen snapshot).
              </p>
            </>
          ) : (
            <p className="text-sm text-neutral-500">
              No CEC designation record for this community.
            </p>
          )}
        </div>
      </section>

      {/* CSC completed actions */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">CSC completed actions</h2>
        {cscRows.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white px-4 py-6 text-sm text-neutral-500">
            No completed CSC actions on file. Public certification reports exist
            for currently certified communities only.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Points</th>
                  <th className="px-4 py-2.5 font-medium">Certified</th>
                </tr>
              </thead>
              <tbody>
                {cscRows.map((r, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2">
                      {r.actionName ?? r.raw}
                      {!r.unmatched && (
                        <span
                          className="ml-1 text-xs text-neutral-400"
                          title="Raw report name; not in the current action checklist (retired or renamed)"
                        >
                          *
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.points ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">{formatDate(r.certifiedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cscRows.some((r) => !r.unmatched) && (
          <p className="mt-2 text-xs text-neutral-400">
            * Action name preserved verbatim from the certification report; not
            matched to the current CSC checklist (retired or renamed action).
          </p>
        )}
      </section>

      {/* CEC completed actions */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">CEC completed actions</h2>
        {cecActionRows.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white px-4 py-6 text-sm text-neutral-500">
            No CEC high-impact actions on file for this community.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Points</th>
                  <th className="px-4 py-2.5 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {cecActionRows.map((r, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2">{r.actionName ?? r.raw}</td>
                    <td className="px-4 py-2 text-neutral-600">{r.category}</td>
                    <td className="px-4 py-2 tabular-nums">{r.points ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">{formatDate(r.completedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="border-t border-neutral-200 pt-6 text-xs text-neutral-500">
        Data: NYSDEC CSC portal (climatesmart.ny.gov) and NYSERDA Clean Energy
        Communities map/scorecard (program closed, frozen snapshot). Pathways is
        an independent open-source project, not affiliated with NYSDEC or NYSERDA.
      </footer>
    </main>
  );
}