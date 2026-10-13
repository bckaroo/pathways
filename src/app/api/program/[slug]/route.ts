import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { actions, programs } from "@/db/schema";

/**
 * GET /api/program/[slug] — serves an authored Pathways program module
 * assembled from the DB (schema: docs/pathways-program-schema.md). Consumed
 * by the tech-tree app via ?data=/api/program/<slug>; falls back to 503 with
 * a hint when the database is unreachable, matching the graceful-degrade
 * convention of the other DB-backed pages.
 */
export const dynamic = "force-dynamic";

const toActionId = (externalId: string): number | null => {
  const m = externalId.match(/^action-(\d+)$/);
  return m ? Number(m[1]) : null;
};

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  try {
    const [pg] = await db.select().from(programs).where(eq(programs.slug, slug));
    if (!pg) {
      return NextResponse.json({ error: `Unknown program: ${slug}` }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(actions)
      .where(eq(actions.programSlug, slug));
    const actionList = rows
      .map((r) => {
        const id = toActionId(r.externalId);
        if (id === null) return null;
        const act: Record<string, unknown> = {
          id,
          name: r.name,
          icon: r.icon ?? "",
          tier: r.tier ?? 0,
          category: r.pledgeElement,
          points: r.pointsDisplay ?? String(r.pointsMax ?? "?"),
          prereq: (r.prereqExternalIds ?? [])
            .map(toActionId)
            .filter((x): x is number => x !== null),
          tags:
            (r.mandatory ? ["Mandatory"] : [])
              .concat(r.priority ? ["Priority"] : [])
              .concat(r.fundingEligible ? ["Grant"] : [])
              .concat(r.cecRelated ? ["CEC"] : [])
              .concat(
                (r.statusTags ?? []).filter((t) => t !== "Mandatory" && t !== "Priority" && t !== "Grant" && t !== "CEC"),
              ),
          why: r.treeWhy ?? r.legacyActionName ?? r.name,
        };
        if (r.details?.length) act.details = r.details;
        if (r.lookback) act.lookback = r.lookback;
        if (r.cobenefits?.length) act.cobenefits = r.cobenefits;
        return act;
      })
      .filter((x): x is Record<string, unknown> => x !== null);

    return NextResponse.json(
      {
        id: slug,
        name: pg.name,
        jurisdiction: pg.jurisdiction ?? pg.agency ?? "",
        source_url: pg.sourceUrl,
        point_ceiling: pg.pointCeiling ?? 300,
        levels: pg.levels ?? [],
        required_actions: (pg.requiredActions ?? [])
          .map(toActionId)
          .filter((x): x is number => x !== null),
        categories: pg.categories ?? [],
        category_names: pg.categoryNames ?? {},
        tiers: pg.tiers ?? [],
        actions: actionList,
      },
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (err) {
    console.error("program read failed", { slug, err });
    return NextResponse.json(
      { error: "database not reachable", hint: "seed with: npx tsx scripts/seed-tree-program.ts" },
      { status: 503 },
    );
  }
}
