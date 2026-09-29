# Basemap — OpenFreeMap

Decision record: **2026-09-28**. Path: `src/components/state-map.tsx`.

## What we use

```
https://tiles.openfreemap.org/styles/positron
```

[OpenFreeMap](https://openfreemap.org) public instance. Chosen because it is
**keyless, registration-free, unlimited, MIT-licensed, and self-hostable** —
which is what a public-good tool actually requires.

Available styles: `liberty` · `bright` · `positron` · `dark` · `fiord`.

## Why not the alternatives

Every keyless **raster** provider is now gated. This was verified live, not
assumed:

| Provider | Result | Failure shape |
|---|---|---|
| CARTO `basemaps.cartocdn.com` | HTTP **200** with a 256×256 "API KEY REQUIRED" watermark PNG | **Silent** — a status check cannot detect it |
| `tile.openstreetmap.org` | HTTP **403** tile usage policy | Explicit |
| StadiaMaps | HTTP **401** invalid authentication | Explicit |

The CARTO case is why this document exists. It served its error **as a 200**, so
DEV-151 was signed off as "verified" while rendering a blank map. Any future
basemap must be checked by looking at **rendered output**, never a status code.

## What we verified about OpenFreeMap (live, 2026-09-28)

| Property | Finding |
|---|---|
| Tile payload | 225–272 KB of real MVT protobuf (not a watermark) |
| CORS | `access-control-allow-origin: *` |
| Caching | `Cache-Control: public, max-age=86400` |
| Style URL stability | `/styles/<name>` resolves server-side via TileJSON, so it tracks the current weekly planet build — **nothing to bump** |
| Dated builds | Archived builds remain served (Jan 2025 paths still work), so pinning is safe |
| `boundary` layer | present from z0, **80 fields**, carries `admin_level` |

### Administrative boundaries come free with the basemap

The `boundary` layer carries `admin_level`, verified by decoding real tiles:

| `admin_level` | Meaning | Confirmed at |
|---|---|---|
| 4 | State | z7 |
| 6 | County | z10, z11 |
| 7 | Municipality / township | z11, z12 |
| 8 | Village / city | z11, z12 |

**These are the same four levels as the GHG inventory grains.** The emissions
work therefore does not need a separate boundary dataset to draw its extents —
it can style directly from the basemap. That removes a whole dependency
(TIGER shapefiles, Census cartographic boundaries) from the GHG task.

## The inline `ny-frame.json`

Retained **only** as the offline fallback background, not as the basemap. It is
a convex hull of our own municipality centroids — an honest visual frame, not a
survey boundary, and it has no geography (no roads, water, or labels).

## Fallback behaviour

If the tile host is unreachable, the component calls `setStyle(OFFLINE_STYLE)`
so **community points still render** on a plain surface, and shows a sky-blue
"Basemap unavailable" banner. Triggers:

- a MapLibre `error` event with status 404, or a message matching
  `tiles.openfreemap.org` / `Failed to fetch` / `NetworkError` / `ERR_`
- or the style not finishing load within 8 s

**This is not a silent fallback.** A map with no roads or labels looks broken,
so the user is told why.

### The `setStyle` trap (this bit is subtle)

`map.setStyle()` **destroys every custom source and layer**. A naive guard on a
`settled` flag would leave the community layer permanently gone after a
fallback — the map would show the fallback surface and **no data**, while
looking healthy. That is exactly the silent-failure class this file exists to
prevent.

So `addCommunityLayer()` guards on `map.getLayer("communities")` rather than on
`settled`, and the poll **keeps running** instead of clearing itself on first
success. The poll is what puts the layer back after a style swap.

## Tests

```bash
npm run smoke:map        # renders? also asserts the vector basemap is live
npm run test:fallback    # blocks the tile host; asserts data survives + user is told
```

`smoke:map` reports the basemap separately from the data: points rendering on
the **fallback** surface is a failure, not a pass, because the user sees no
geography.

## Self-hosting

One-line change — swap `OFM_STYLE_URL` (exported from `state-map.tsx`) for your
own instance. That is the point: for a self-hostable public good the dependency
must be a **URL**, not an account.

## Attribution

Required, and satisfied automatically because we use MapLibre:

> OpenFreeMap © OpenMapTiles · Data from OpenStreetMap

If output is ever exported to print or video, it must be added manually.
