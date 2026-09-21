import { count } from "drizzle-orm";
import { db } from "@/db";
import { actions, certifications, completions, municipalities } from "@/db/schema";

type Stats = {
  municipalities: number;
  certified: number;
  actions: number;
  completions: number;
  dbReady: boolean;
};

async function loadStats(): Promise<Stats> {
  try {
    const [[m], [c], [a], [k]] = await Promise.all([
      db.select({ n: count() }).from(municipalities),
      db.select({ n: count() }).from(certifications),
      db.select({ n: count() }).from(actions),
      db.select({ n: count() }).from(completions),
    ]);
    return {
      municipalities: Number(m.n),
      certified: Number(c.n),
      actions: Number(a.n),
      completions: Number(k.n),
      dbReady: true,
    };
  } catch {
    return { municipalities: 0, certified: 0, actions: 0, completions: 0, dbReady: false };
  }
}

export default async function Home() {
  const stats = await loadStats();

  const cards = [
    { label: "Registered communities", value: stats.municipalities, hint: "CSC registrations statewide" },
    { label: "Currently certified", value: stats.certified, hint: "Bronze, Silver or Gold" },
    { label: "Actions in library", value: stats.actions, hint: "2025 CSC certification checklist" },
    { label: "Actions completed", value: stats.completions, hint: "Parsed from certification reports" },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">
          Open source · AGPL-3.0
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Pathways</h1>
        <p className="mt-3 text-lg text-neutral-600">
          A free, self-hostable climate-action dashboard for New York State
          communities, tracking{" "}
          <a
            className="underline decoration-emerald-600 underline-offset-2"
            href="https://climatesmart.ny.gov"
            target="_blank"
            rel="noreferrer"
          >
            NYSDEC Climate Smart Communities
          </a>{" "}
          and{" "}
          <a
            className="underline decoration-emerald-600 underline-offset-2"
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
        <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database not reachable. Start it with{" "}
          <code className="rounded bg-amber-100 px-1">docker compose up -d</code>, run{" "}
          <code className="rounded bg-amber-100 px-1">npm run db:migrate</code>, then{" "}
          <code className="rounded bg-amber-100 px-1">npm run ingest:csc:actions</code> and{" "}
          <code className="rounded bg-amber-100 px-1">npm run ingest:csc:communities</code>.
          See the README quickstart.
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <div className="text-3xl font-bold tabular-nums">
              {c.value.toLocaleString("en-US")}
            </div>
            <div className="mt-1 font-medium">{c.label}</div>
            <div className="text-sm text-neutral-500">{c.hint}</div>
          </div>
        ))}
      </section>

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-sm text-neutral-500">
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