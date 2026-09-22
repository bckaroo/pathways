import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { cecDesignations, municipalities } from "@/db/schema";
import CommunityTable, { type CommunityRow } from "@/components/community-table";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Communities — Pathways",
  description:
    "Browse New York communities tracked in the CSC and CEC climate programs.",
};

function cscLabelFor(level: number | null, levelName: string | null): string | null {
  if (levelName) return levelName;
  if (level != null && level >= 2) return "Certified";
  return level != null ? "Registered" : null;
}

function cecLabelFor(status: string | null): string | null {
  if (status === "Designated CEC") return "Designated";
  if (status === "Not Designated") return "Not designated";
  return null;
}

async function loadRows(): Promise<CommunityRow[] | null> {
  try {
    const rows = await db
      .select({
        uid: municipalities.portalUid,
        name: municipalities.name,
        areaType: municipalities.areaType,
        county: municipalities.county,
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
    return rows.map((r) => ({
      uid: r.uid,
      name: r.name,
      areaType: r.areaType,
      county: r.county,
      cscLabel: cscLabelFor(r.cscLevel, r.cscLevelName),
      cecLabel: cecLabelFor(r.cecStatus),
      cecStars: Number.parseInt((r.cecStars ?? "").replace(/[^0-9]/g, ""), 10) || 0,
    }));
  } catch {
    return null;
  }
}

export default async function CommunitiesPage() {
  const rows = await loadRows();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <nav className="mb-4 text-sm text-neutral-500">
          <Link href="/" className="hover:underline">
            ← Pathways
          </Link>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">Communities</h1>
        <p className="mt-2 max-w-3xl text-neutral-600">
          Every municipality tracked in the Climate Smart Communities (CSC) and
          Clean Energy Communities (CEC) programs. Open a community for its
          certification details and completed actions.
        </p>
      </header>

      {rows === null ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
          Database not reachable. Start it with{" "}
          <code className="rounded bg-amber-100 px-1">docker compose up -d</code>{" "}
          and reload.
        </div>
      ) : (
        <CommunityTable rows={rows} />
      )}
    </main>
  );
}