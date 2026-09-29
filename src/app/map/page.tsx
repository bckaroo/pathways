import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { cecDesignations, municipalities } from "@/db/schema";
import StateMap, { type MapCommunity } from "@/components/state-map";

// Next resolves this directive STATICALLY — a computed value is rejected with
// "Unsupported node type ConditionalExpression". The two deployment modes are
// therefore handled by two route-directive files: this one (live) keeps
// force-dynamic, and the export build swaps in `static-page-config` via
// scripts/to-static-export.mjs. See docs/static-export.md.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Statewide map — Pathways",
  description:
    "Statewide MapLibre map of New York communities in the NYSDEC Climate Smart Communities and NYSERDA Clean Energy Communities programs.",
};

async function loadCommunities(): Promise<MapCommunity[] | null> {
  try {
    const rows = await db
      .select({
        uid: municipalities.portalUid,
        name: municipalities.name,
        areaType: municipalities.areaType,
        county: municipalities.county,
        lat: municipalities.latitude,
        lon: municipalities.longitude,
        cscLevel: municipalities.certificationLevel,
        cscLevelName: municipalities.certificationLevelName,
        cecStatus: cecDesignations.status,
        cecStars: cecDesignations.advancedDesignation,
      })
      .from(municipalities)
      .leftJoin(
        cecDesignations,
        eq(cecDesignations.municipalityUid, municipalities.portalUid),
      )
      .orderBy(asc(municipalities.name));
    return rows
      .filter((r) => r.lat != null && r.lon != null)
      .map((r) => ({
        uid: r.uid,
        name: r.name,
        areaType: r.areaType,
        county: r.county,
        lat: r.lat as number,
        lon: r.lon as number,
        cscLevel: r.cscLevel ?? null,
        cscLevelName: r.cscLevelName ?? null,
        cecStatus: r.cecStatus ?? null,
        cecStars: r.cecStars ?? null,
      }));
  } catch {
    return null;
  }
}

export default async function MapPage() {
  const communities = await loadCommunities();

  const certified = communities?.filter((c) => (c.cscLevel ?? 0) >= 2).length ?? 0;
  const designated =
    communities?.filter((c) => c.cecStatus === "Designated CEC").length ?? 0;
  const starred = communities?.filter((c) => c.cecStars != null).length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <nav className="mb-4 text-sm text-ink-muted">
          <Link href="/" className="hover:underline">
            ← Pathways
          </Link>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">Statewide map</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">
          New York communities in the{" "}
          <a
            className="underline decoration-ok-solid underline-offset-2"
            href="https://climatesmart.ny.gov"
            target="_blank"
            rel="noreferrer"
          >
            Climate Smart Communities
          </a>{" "}
          (CSC) and{" "}
          <a
            className="underline decoration-ok-solid underline-offset-2"
            href="https://www.nyserda.ny.gov/cec"
            target="_blank"
            rel="noreferrer"
          >
            Clean Energy Communities
          </a>{" "}
          (CEC) programs. Toggle the color mode between CSC certification level
          and CEC designation / Advanced (v3.0) stars.
        </p>
      </header>

      {communities === null ? (
        <div className="rounded-lg border border-warn-line bg-warn-soft px-4 py-8 text-center text-sm text-warn-ink">
          Database not reachable. Start it with{" "}
          <code className="rounded bg-warn-soft-strong px-1">docker compose up -d</code>{" "}
          and reload.
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Communities mapped", value: communities.length },
              { label: "CSC certified", value: certified },
              { label: "CEC designated", value: designated },
              { label: "CEC stars (1–5★)", value: starred },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-line bg-panel px-4 py-3 shadow-sm"
              >
                <div className="text-2xl font-bold tabular-nums">
                  {s.value.toLocaleString("en-US")}
                </div>
                <div className="text-sm text-ink-muted">{s.label}</div>
              </div>
            ))}
          </div>
          <StateMap communities={communities} />
        </>
      )}
    </main>
  );
}