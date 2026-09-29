# Static export for GitHub Pages

The published site at `https://bckaroo.github.io/pathways/` is a **build-time
snapshot**, not a live app. This documents how it is produced and why it is
built the way it is.

## Why a snapshot, and not live data

Pages serves static files. There is no Node process and no Postgres. The three
data routes (`/map`, `/communities`, `/communities/[uid]`) read the database at
request time when self-hosted, so the published site prerenders them once at
build time instead. Every published number is frozen at the commit that built it.

That trade-off is deliberate: the Pages site demonstrates the full UI with real
data, reproducibly, without turning a demo into an operational service.

## Why the build does not re-scrape

The nine `ingest:*` scripts fetch from `climatesmart.ny.gov`, NYSERDA's Tableau
dashboards and the Census Gazetteer. Running them in CI would:

- make the published site depend on a third party's uptime and markup,
- take roughly three minutes (`ingest:csc:communities` alone scrapes around 478
  report pages),
- hammer a government portal from GitHub's runners,
- make the same commit render differently on different days.

Instead CI restores `data/pathways-snapshot.sql.gz` — 0.8 MB gzipped, 12,288
rows across 10 tables — and asserts the row counts before building. Refresh it
deliberately when the upstream data changes:

```bash
npm run snapshot:dump -- --force     # writes data/pathways-snapshot.sql.gz
git add data/pathways-snapshot.sql.gz
```

The snapshot doubles as a working starting database for self-hosters, who can
`npm run snapshot:restore` instead of spending three minutes scraping.

## Why the routes are rewritten during the build

Next.js resolves `export const dynamic` **statically**. A computed directive is
rejected outright:

```
Unsupported node type "ConditionalExpression" at "dynamic"
```

So the directive has to be a literal, which means the source must differ between
the live deployment and the static export. `scripts/to-static-export.mjs` swaps
`force-dynamic` → `force-static` across the three routes, and the build reverts it:

```bash
npm run export:apply     # force-dynamic -> force-static
npm run export:revert    # back again (always run this after a local export)
npm run build:static     # apply + STATIC_EXPORT=1 next build
```

The script is idempotent, refuses to guess if a route's shape has changed, and
verifies the resulting state rather than trusting the write.

**The live source in git always carries `force-dynamic`.** Never commit the
static variant; CI applies it only inside the runner.

## Why `.nojekyll`

GitHub Pages runs Jekyll by default, and Jekyll silently drops directories whose
name begins with an underscore — which would delete `_next/` and break every
stylesheet and script on the site. The workflow writes `out/.nojekyll` before
uploading. Omitting it produces a site that loads with no styling and no
JavaScript, and no obvious error.

## Why `basePath` matters

Project pages are served from `https://<user>.github.io/<repo>/`, so asset URLs
need that prefix or every `_next/*` request 404s. The workflow passes
`PAGES_BASE_PATH=/<repo>`, and `next.config.ts` applies it only when
`STATIC_EXPORT=1` — the self-hosted app keeps serving from `/`.

## Size

| | |
|---|---|
| Export total | ~122 MB |
| Community profiles | 1,024, averaging ~115 KB |
| Pages soft limit | 1 GB site, 100 GB/month bandwidth |

Comfortably inside the limit. The per-profile weight is dominated by React's RSC
flight payload (~58% of the bytes, carrying the same data the HTML already
contains); trimming it would speed up the live app too, and is tracked as
follow-up rather than done here.

## Verifying a local export

```bash
npm run export:apply
STATIC_EXPORT=1 PAGES_BASE_PATH=/pathways npx next build
find out -name '*.html' | wc -l          # expect >= 1024
grep -c "New Rochelle" out/communities/1003/index.html
npm run export:revert                    # IMPORTANT: leave the tree live
```

CI runs the equivalent of these as gates, so a short export or a profile missing
its data fails the deploy instead of publishing a plausible-looking wrong site.
