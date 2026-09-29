import { count, eq, gt, isNotNull } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import {
  actions,
  cecCompletions,
  cecDesignations,
  certifications,
  completions,
  municipalities,
} from "@/db/schema";

type Stats = {
  cscCommunities: number;
  certified: number;
  cecTracked: number;
  cecDesignated: number;
  cecStars: number;
  actions: number;
  completions: number;
  cecCompletions: number;
  dbReady: boolean;
};

async function loadStats(): Promise<Stats> {
  try {
    const [[m], [c], [a], [k], [t], [d], [s], [ck]] = await Promise.all([
      db.select({ n: count() }).from(municipalities).where(gt(municipalities.portalUid, 0)),
      db.select({ n: count() }).from(certifications),
      db.select({ n: count() }).from(actions),
      db.select({ n: count() }).from(completions),
      db.select({ n: count() }).from(cecDesignations),
      db
        .select({ n: count() })
        .from(cecDesignations)
        .where(eq(cecDesignations.status, "Designated CEC")),
      db
        .select({ n: count() })
        .from(cecDesignations)
        .where(isNotNull(cecDesignations.advancedDesignation)),
      db.select({ n: count() }).from(cecCompletions),
    ]);
    return {
      cscCommunities: Number(m.n),
      certified: Number(c.n),
      actions: Number(a.n),
      completions: Number(k.n),
      cecTracked: Number(t.n),
      cecDesignated: Number(d.n),
      cecStars: Number(s.n),
      cecCompletions: Number(ck.n),
      dbReady: true,
    };
  } catch {
    return {
      cscCommunities: 0,
      certified: 0,
      actions: 0,
      completions: 0,
      cecTracked: 0,
      cecDesignated: 0,
      cecStars: 0,
      cecCompletions: 0,
      dbReady: false,
    };
  }
}

export default async function Home() {
  const stats = await loadStats();

  const cscCards = [
    { label: "CSC communities", value: stats.cscCommunities, hint: "Registered in the CSC program" },
    { label: "Currently certified", value: stats.certified, hint: "Bronze, Silver or Gold" },
    { label: "Actions in library", value: stats.actions, hint: "2025 CSC certification checklist" },
    { label: "Actions completed", value: stats.completions, hint: "Parsed from certification reports" },
  ];
  const cecCards = [
    { label: "CEC communities tracked", value: stats.cecTracked, hint: "NYSERDA CEC program (closed)" },
    { label: "CEC designated", value: stats.cecDesignated, hint: "Designated Clean Energy Communities" },
    { label: "Advanced stars (1\u20135★)", value: stats.cecStars, hint: "Advanced (v3.0) star ratings" },
    { label: "CEC actions completed", value: stats.cecCompletions, hint: "High-impact actions, frozen snapshot" },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-widest text-ok-solid">
          Open source · AGPL-3.0
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Pathways</h1>
        <p className="mt-3 text-lg text-ink-muted">
          A free, self-hostable climate-action dashboard for New York State
          communities, tracking{" "}
          <a
            className="underline decoration-ok-solid underline-offset-2"
            href="https://climatesmart.ny.gov"
            target="_blank"
            rel="noreferrer"
          >
            NYSDEC Climate Smart Communities
          </a>{" "}
          and{" "}
          <a
            className="underline decoration-ok-solid underline-offset-2"
            href="https://www.nyserda.ny.gov/cec"
            target="_blank"
            rel="noreferrer"
          >
            NYSERDA Clean Energy Communities
          </a>{" "}
          program data.
        </p>
      </header>

      {!stats.dbReady && (
        <div className="mb-8 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn-ink">
          Database not reachable. Start it with{" "}
          <code className="rounded bg-warn-soft-strong px-1">docker compose up -d</code>, run{" "}
          <code className="rounded bg-warn-soft-strong px-1">npm run db:migrate</code>, then{" "}
          <code className="rounded bg-warn-soft-strong px-1">npm run ingest:csc:actions</code> and{" "}
          <code className="rounded bg-warn-soft-strong px-1">npm run ingest:csc:communities</code>.
          See the README quickstart.
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          href="/map"
          className="rounded-lg bg-ok-solid px-5 py-2.5 font-medium text-ok-on-solid shadow-sm transition hover:bg-ok-solid"
        >
          Explore the statewide map →
        </Link>
        <Link
          href="/communities"
          className="rounded-lg border border-line-strong bg-panel px-5 py-2.5 font-medium text-ink-muted shadow-sm transition hover:border-neutral-400"
        >
          Browse communities →
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cscCards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-line bg-panel p-6 shadow-sm"
          >
            <div className="text-3xl font-bold tabular-nums">
              {c.value.toLocaleString("en-US")}
            </div>
            <div className="mt-1 font-medium">{c.label}</div>
            <div className="text-sm text-ink-muted">{c.hint}</div>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Clean Energy Communities (historical · program closed)
        </h2>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cecCards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-line bg-panel p-6 shadow-sm"
            >
              <div className="text-3xl font-bold tabular-nums">
                {c.value.toLocaleString("en-US")}
              </div>
              <div className="mt-1 font-medium">{c.label}</div>
              <div className="text-sm text-ink-muted">{c.hint}</div>
            </div>
          ))}
        </section>
      </section>

      <footer className="mt-12 border-t border-line pt-6 text-sm text-ink-muted">
        <p>
          Data sources: NYSDEC Climate Smart Communities program portal
          (climatesmart.ny.gov) and NYSERDA Clean Energy Communities program
          materials. Pathways is an independent open-source project and is not
          affiliated with, endorsed by, or sponsored by NYSDEC or NYSERDA.
        </p>
      </footer>
    </main>
  );
}