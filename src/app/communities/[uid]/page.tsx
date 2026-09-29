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
import ProgressionPanel from "@/components/progression-panel";
import SectorRadial from "@/components/sector-radial";

// Next resolves this directive STATICALLY — a computed value is rejected with
// "Unsupported node type ConditionalExpression". The two deployment modes are
// therefore handled by two route-directive files: this one (live) keeps
// force-dynamic, and the export build swaps in `static-page-config` via
// scripts/to-static-export.mjs. See docs/static-export.md.
export const dynamic = "force-dynamic";

// Enumerate every community for the static build so `output: export` can emit
// one HTML file per profile. Without this the export fails on a dynamic route.
// Returns [] in live mode (the route stays dynamic and ignores it).
export async function generateStaticParams() {
  if (process.env.STATIC_EXPORT !== "1") return [];
  try {
    const rows = await db
      .select({ uid: municipalities.portalUid })
      .from(municipalities);
    return rows.map((r) => ({ uid: String(r.uid) }));
  } catch {
    // Let the build proceed and fail loudly on its own terms rather than
    // reporting a confusing empty-params error.
    return [];
  }
}

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
  Gold: "bg-warn-soft-strong text-warn-ink ring-warn-line",
  Silver: "bg-panel-muted text-ink-muted ring-line-strong",
  Bronze: "bg-warn-soft-strong text-warn-ink ring-warn-line",
  Registered: "bg-info-soft-strong text-info-ink ring-info-line",
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
        <div className="rounded-lg border border-warn-line bg-warn-soft px-4 py-8 text-center text-sm text-warn-ink">
          Database not reachable. Start it with{" "}
          <code className="rounded bg-warn-soft-strong px-1">docker compose up -d</code>{" "}
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
        // Needed by the progression panel to group branches and to apply the
        // gating rules (mandatory + priority are level prerequisites, not just
        // point sources).
        pledgeElement: actions.pledgeElement,
        priority: actions.priority,
        mandatory: actions.mandatory,
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

  // Full CSC catalogue. Needed as the DENOMINATOR for sector coverage: without
  // it we can only see what a community did, not what was available to do, and
  // every sector would look either saturated or empty.
  const cscCatalogue = await db
    .select({
      externalId: actions.externalId,
      name: actions.name,
      pointsMin: actions.pointsMin,
      pointsMax: actions.pointsMax,
      priority: actions.priority,
      mandatory: actions.mandatory,
      fundingEligible: actions.fundingEligible,
    })
    .from(actions)
    .where(eq(actions.programSlug, "csc"))
    .orderBy(asc(actions.name));

  const cert = certRows[0] ?? null;
  const cec = cecRowRows[0] ?? null;
  const stars = parseStars(cec?.advancedDesignation ?? null);
  const cscBadge = levelBadgeLabel(
    cert?.level ?? base.certificationLevel ?? (base.portalUid > 0 ? 0 : null),
    cert?.levelName ?? base.certificationLevelName ?? null,
  );
  const cscPoints = cert?.pointsApproved ?? null;

  // Shape completions for the progression panel. Kept explicit rather than
  // passed straight through so the panel's contract stays narrow and the
  // unmatched-action count is visible to the caller.
  const progressionActions = cscRows.map((r) => ({
    group: r.pledgeElement ?? null,
    name: r.actionName ?? null,
    rawName: r.raw ?? "",
    points: r.points ?? null,
    priority: Boolean(r.priority),
    mandatory: Boolean(r.mandatory),
  }));
  const progressionCert = cert
    ? {
        level: cert.level ?? null,
        levelName: cert.levelName ?? null,
        pointsApproved: cert.pointsApproved ?? null,
        certifiedOn: cert.certifiedOn ?? null,
      }
    : null;

  // Shape for the sector radial. Completions whose action could not be matched
  // to the catalogue have no external id, so they cannot be assigned a sector —
  // the radial reports that count rather than dropping them silently.
  const sectorCatalogue = cscCatalogue.map((a) => ({
    externalId: a.externalId,
    name: a.name,
    pointsMin: a.pointsMin ?? null,
    pointsMax: a.pointsMax ?? null,
    priority: Boolean(a.priority),
    mandatory: Boolean(a.mandatory),
    fundingEligible: Boolean(a.fundingEligible),
  }));
  const sectorCompleted = cscRows
    .filter((r) => r.unmatched)
    .map((r) => ({ externalId: r.unmatched as string, points: r.points ?? null }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="mb-4 text-sm text-ink-muted">
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
        <p className="mt-1 text-ink-muted">
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
        <div className="rounded-xl border border-line bg-panel p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Climate Smart Communities (CSC)
          </h2>
          <div className="flex items-baseline gap-3">
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
                BADGES[cscBadge] ?? "bg-panel-muted text-ink-muted ring-line-strong"
              }`}
            >
              {cscBadge}
            </span>
            {cscPoints != null && (
              <span className="text-2xl font-bold tabular-nums">{cscPoints} pts</span>
            )}
          </div>
          {cert ? (
            <dl className="mt-3 space-y-1 text-sm text-ink-muted">
              <div>
                <dt className="inline font-medium text-ink">Certified: </dt>
                <dd className="inline">{formatDate(cert.certifiedOn)}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">Report: </dt>
                <dd className="inline">
                  {cert.reportUrl ? (
                    <a
                      href={cert.reportUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ok-solid hover:underline"
                    >
                      {cert.name}
                    </a>
                  ) : (
                    cert.name
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">Completed actions: </dt>
                <dd className="inline">{cscRows.length.toLocaleString("en-US")}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              {base.portalUid > 0
                ? "Registered in the CSC program; no certification report on file yet."
                : "Tracked by CEC only; no CSC participation on record."}
            </p>
          )}
        </div>

        {/* CEC designation card */}
        <div className="rounded-lg border border-line bg-panel p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Clean Energy Communities (CEC)
          </h2>
          {cec ? (
            <>
              <div className="flex items-baseline gap-3">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${
                    cec.status === "Designated CEC"
                      ? "bg-ok-soft-strong text-ok-ink ring-ok-line"
                      : "bg-panel-muted text-ink-muted ring-line-strong"
                  }`}
                >
                  {cec.status === "Designated CEC" ? "Designated" : "Not designated"}
                </span>
                {stars > 0 && (
                  <span className="text-2xl font-bold text-ok-solid">
                    {"★".repeat(stars)}
                  </span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-ink-muted">
                <div>
                  <dt className="inline font-medium text-ink">HIAs approved: </dt>
                  <dd className="inline">{cec.hiasApproved ?? 0}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink">Points: </dt>
                  <dd className="inline">{cec.pointsAchievedTotal ?? 0}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink">Population: </dt>
                  <dd className="inline">
                    {cec.population != null ? cec.population.toLocaleString("en-US") : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink">Size: </dt>
                  <dd className="inline">{cec.communitySize ?? "—"}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink">Last HIA: </dt>
                  <dd className="inline">{formatDate(cec.latestActionApprovedOn)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink">Actions: </dt>
                  <dd className="inline">{cecActionRows.length.toLocaleString("en-US")}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-ink-subtle">
                CEC program closed; designation and star data are historical
                (NYSERDA, frozen snapshot).
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              No CEC designation record for this community.
            </p>
          )}
        </div>
      </section>

      {/* Certification path — the skill tree. Rendered before the raw action
          list because it answers "where am I and what unlocks next", which is
          the question the raw list cannot. */}
      <div className="mb-10">
        <ProgressionPanel actions={progressionActions} cert={progressionCert} />
      </div>

      {/* Sector radial — which emitting sectors the actions actually address.
          Placed after the path so "what unlocks next" leads, with "where the
          effort is going" as the supporting view. */}
      <div className="mb-10">
        <SectorRadial catalogue={sectorCatalogue} completed={sectorCompleted} />
      </div>

      {/* CSC completed actions */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">CSC completed actions</h2>
        {cscRows.length === 0 ? (
          <p className="rounded-lg border border-line bg-panel px-4 py-6 text-sm text-ink-muted">
            No completed CSC actions on file. Public certification reports exist
            for currently certified communities only.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-panel shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Points</th>
                  <th className="px-4 py-2.5 font-medium">Certified</th>
                </tr>
              </thead>
              <tbody>
                {cscRows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      {r.actionName ?? r.raw}
                      {!r.unmatched && (
                        <span
                          className="ml-1 text-xs text-ink-subtle"
                          title="Raw report name; not in the current action checklist (retired or renamed)"
                        >
                          *
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.points ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">{formatDate(r.certifiedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cscRows.some((r) => !r.unmatched) && (
          <p className="mt-2 text-xs text-ink-subtle">
            * Action name preserved verbatim from the certification report; not
            matched to the current CSC checklist (retired or renamed action).
          </p>
        )}
      </section>

      {/* CEC completed actions */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">CEC completed actions</h2>
        {cecActionRows.length === 0 ? (
          <p className="rounded-lg border border-line bg-panel px-4 py-6 text-sm text-ink-muted">
            No CEC high-impact actions on file for this community.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-panel shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Points</th>
                  <th className="px-4 py-2.5 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {cecActionRows.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{r.actionName ?? r.raw}</td>
                    <td className="px-4 py-2 text-ink-muted">{r.category}</td>
                    <td className="px-4 py-2 tabular-nums">{r.points ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">{formatDate(r.completedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="border-t border-line pt-6 text-xs text-ink-muted">
        Data: NYSDEC CSC portal (climatesmart.ny.gov) and NYSERDA Clean Energy
        Communities map/scorecard (program closed, frozen snapshot). Pathways is
        an independent open-source project, not affiliated with NYSDEC or NYSERDA.
      </footer>
    </main>
  );
}