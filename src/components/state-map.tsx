"use client";

/**
 * Statewide community map (MapLibre GL, v1 dashboard — DEV-151).
 *
 * Server pages pass the full community dataset; this component renders one
 * circle per municipality over a free CARTO/OpenStreetMap raster basemap.
 * Color mode toggles between CSC certification level and CEC designation /
 * Advanced (v3.0) star status. Clicking a point opens a popup with a link to
 * the community profile page.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DataDrivenPropertyValueSpecification } from "@maplibre/maplibre-gl-style-spec";
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import NY_FRAME from "@/lib/ny-frame.json";
import { setWorkerUrl } from "maplibre-gl";

// ---------------------------------------------------------------------------
// Basemap: OpenFreeMap public instance.
//
// Why this and not a keyed provider: it is keyless, registration-free, has no
// request limits, the whole stack is MIT-licensed and self-hostable, and the
// style URL is version-stable — `/styles/<name>` resolves server-side to the
// current weekly planet build via a TileJSON pointer, so nothing needs bumping
// when tiles are rebuilt. Verified live 2026-09-28.
//
// Self-hosting is a one-line change to this constant. That is the point: for a
// self-hostable public good the dependency must be a URL, not an account.
//
// To pin a specific planet build instead of tracking latest, replace with e.g.
//   https://tiles.openfreemap.org/planet/20260913_164504_pt  (as a TileJSON URL)
// Archived dated builds remain served, so pinning is safe.
//
// Styles available: liberty | bright | positron | dark | fiord
// positron is the muted light style; it keeps our data layer legible.
export const OFM_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// Fallback style for when the basemap is unreachable. Keeps the data layer
// visible on a plain surface instead of showing the user a blank canvas —
// the lesson from the CARTO incident, where a failing basemap silently took
// the community points down with it.
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "ny-frame": {
      type: "geojson",
      data: NY_FRAME as GeoJSON.FeatureCollection,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f4f6f9" } },
    {
      id: "ny-frame-fill",
      type: "fill",
      source: "ny-frame",
      paint: { "fill-color": "#e6ecf4", "fill-opacity": 1 },
    },
    {
      id: "ny-frame-outline",
      type: "line",
      source: "ny-frame",
      paint: { "line-color": "#b9c6d6", "line-width": 1.2 },
    },
  ],
};

// ---------------------------------------------------------------------------
// MapLibre v6 worker registration — REQUIRED, and the cause of the blank map.
//
// MapLibre v6 ships as ESM only and does all source/tile parsing in a Web
// Worker (dist/maplibre-gl-worker.mjs), which itself imports a sibling chunk
// (dist/maplibre-gl-shared.mjs) by RELATIVE path. Inside a bundler,
// `import.meta.url` does not reliably resolve to that worker file, so the
// worker request 404s.
//
// The failure mode is uniquely nasty: the main module loads, the style loads,
// the canvas paints, the source is *created* — but the source never finishes
// loading (loaded=false forever) and NO error is emitted anywhere. The
// style's "load" event therefore never fires, so the entire data layer is
// silently skipped while the page still returns HTTP 200. That is exactly how
// DEV-151 reported this map as "verified".
//
// Both files are copied to public/maplibre/ (see the copy-maplibre-worker
// script) because the worker's relative import requires them side by side.
// ---------------------------------------------------------------------------
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export type MapCommunity = {
  uid: number;
  name: string;
  areaType: string | null;
  county: string | null;
  lat: number;
  lon: number;
  cscLevel: number | null;
  cscLevelName: string | null;
  cecStatus: string | null;
  cecStars: string | null;
};

type MapMode = "csc" | "cec";

type CommunityProperties = {
  uid: number;
  name: string;
  areaType: string;
  county: string;
  csc: string;
  cec: string;
  stars: number;
  cscColor: string;
  cecColor: string;
};

const CSC_COLORS = {
  registered: "#2563eb",
  bronze: "#b45309",
  silver: "#64748b",
  gold: "#ca8a04",
} as const;

const CEC_COLORS = {
  notDesignated: "#9ca3af",
  designated: "#a3e635",
  stars: ["#4ade80", "#22c55e", "#16a34a", "#15803d", "#14532d"], // 1..5
} as const;

function cscColorFor(c: MapCommunity): string {
  const level = c.cscLevel ?? 0;
  if (level >= 6) return CSC_COLORS.gold;
  if (level >= 4) return CSC_COLORS.silver;
  if (level >= 2) return CSC_COLORS.bronze;
  return CSC_COLORS.registered;
}

function cecColorFor(c: MapCommunity): string {
  const stars = parseStars(c.cecStars);
  if (stars > 0) return CEC_COLORS.stars[Math.min(stars, 5) - 1];
  if (c.cecStatus === "Designated CEC") return CEC_COLORS.designated;
  return CEC_COLORS.notDesignated;
}

function parseStars(stars: string | null): number {
  const n = Number.parseInt((stars ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function colorExpr(prop: "cscColor" | "cecColor"): DataDrivenPropertyValueSpecification<string> {
  return ["get", prop];
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(p: CommunityProperties): string {
  const cscLine = p.csc
    ? `<div><span class="font-medium">CSC:</span> ${esc(p.csc)}</div>`
    : "";
  const cecLine = p.cec
    ? `<div><span class="font-medium">CEC:</span> ${esc(p.cec === "Designated CEC" ? "Designated" : p.cec)}${
        p.stars > 0 ? ` · ${"★".repeat(p.stars)}` : ""
      }</div>`
    : "";
  return (
    `<div class="min-w-44"><strong>${esc(p.name)}</strong>` +
    `<div class="text-neutral-500">${esc(p.areaType)}${p.county ? ` · ${esc(p.county)} County` : ""}</div>` +
    `<div class="mt-1 space-y-0.5">${cscLine}${cecLine}</div>` +
    `<a class="mt-2 inline-block font-medium text-emerald-700 hover:underline" href="/communities/${p.uid}">Open profile →</a></div>`
  );
}

const LEGENDS: Record<MapMode, { color: string; label: string }[]> = {
  csc: [
    { color: CSC_COLORS.registered, label: "Registered" },
    { color: CSC_COLORS.bronze, label: "Bronze" },
    { color: CSC_COLORS.silver, label: "Silver" },
    { color: CSC_COLORS.gold, label: "Gold" },
  ],
  cec: [
    { color: CEC_COLORS.notDesignated, label: "Not designated" },
    { color: CEC_COLORS.designated, label: "Designated" },
    { color: CEC_COLORS.stars[0], label: "★ 1" },
    { color: CEC_COLORS.stars[1], label: "★ 2" },
    { color: CEC_COLORS.stars[2], label: "★ 3" },
    { color: CEC_COLORS.stars[3], label: "★ 4" },
    { color: CEC_COLORS.stars[4], label: "★ 5" },
  ],
};

export default function StateMap({ communities }: { communities: MapCommunity[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mode, setMode] = useState<MapMode>("csc");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  // Degraded = map mounted but the community data layer never attached.
  // Distinct from `failed` (WebGL/constructor error). Both are visible.
  const [degraded, setDegraded] = useState(false);
  // basemapDegraded = community points ARE rendering, but on the fallback
  // surface because the tile host was unreachable. Distinct from `degraded`:
  // data is fine, the pretty map is missing.
  const [basemapDegraded, setBasemapDegraded] = useState(false);
  const timeoutsRef = useRef<number[]>([]);

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, CommunityProperties>>(
    () => ({
      type: "FeatureCollection",
      features: communities.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: {
          uid: c.uid,
          name: c.name,
          areaType: c.areaType ?? "",
          county: c.county ?? "",
          csc: c.cscLevelName ?? (c.cscLevel != null ? "Registered" : ""),
          cec: c.cecStatus ?? "",
          stars: parseStars(c.cecStars),
          cscColor: cscColorFor(c),
          cecColor: cecColorFor(c),
        },
      })),
    }),
    [communities],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        // ------------------------------------------------------------------
        // BASEMAP: OpenFreeMap (https://openfreemap.org) — real vector tiles,
        // no API key, no registration, no request limits, MIT-licensed stack,
        // and self-hostable with the same style URL.
        //
        // History of this line, because it matters:
        //   1. CARTO keyless raster — CARTO changed policy and began returning
        //      a 256x256 "API KEY REQUIRED" watermark PNG *as HTTP 200*, so
        //      nothing looked broken while the map rendered blank.
        //   2. OSM raster (403 tile usage policy) and StadiaMaps (401) — also
        //      gated. Every keyless raster provider is now closed.
        //   3. Hand-rolled inline GeoJSON frame — a convex hull of our own
        //      municipality centroids. Honest but not a real boundary, and it
        //      had no geography: no roads, water, or place labels.
        //   4. THIS: OpenFreeMap vector tiles. Verified live 2026-09-28 —
        //      245 KB tiles of real MVT data, CORS `*`, and its /planet
        //      TileJSON resolves dynamically to the current weekly build, so
        //      the style URL is version-stable and needs no maintenance.
        //
        // Verified the boundary layer carries `admin_level`, which gives us
        // real administrative geography straight from the basemap:
        //   admin_level 4 = state, 6 = county, 7 = municipality, 8 = village
        // — the same four levels as the GHG inventory grains. The GHG work no
        // longer needs a separate boundary dataset to draw its extents.
        //
        // Self-hosting note: swapping to a self-hosted instance is a one-line
        // change to this URL, which is what "self-hostable public good"
        // actually requires. The dependency is a URL, not an account.
        // ------------------------------------------------------------------
        style: OFM_STYLE_URL,
        center: [-75.45, 42.93],
        zoom: 5.9,
        minZoom: 4,
        maxZoom: 14,
        // Attribution is required by OpenFreeMap/OpenStreetMap/OpenMapTiles.
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // Dev-only handle for the rendered-map smoke test
    // (scripts/smoke_map.py). Without this, an automated check can only
    // sample canvas pixels — it cannot assert that the source loaded or that
    // queryRenderedFeatures() returns features. Not exposed in production.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __pathwaysMap?: MapLibreMap }).__pathwaysMap = map;
    }

    // ------------------------------------------------------------------
    // BASEMAP FALLBACK
    //
    // If the tile host is unreachable (offline, DNS, provider outage), swap to
    // a self-contained style so the community points still render on a plain
    // surface. This is deliberately NOT a silent fallback: `basemapDegraded`
    // is surfaced in the UI, because a map with no roads or labels looks
    // broken and the user should know why.
    //
    // The failure we are protecting against is specific: previously a
    // failing basemap took the data layer down with it and the page still
    // returned HTTP 200. Data must survive a basemap failure.
    // ------------------------------------------------------------------
    let basemapSwapped = false;
    const swapToOfflineBasemap = () => {
      if (basemapSwapped) return;
      basemapSwapped = true;
      try {
        map.setStyle(OFFLINE_STYLE, { diff: false });
        setBasemapDegraded(true);
      } catch {
        /* if even this fails, the degraded banner below still reports it */
      }
    };

    map.on("error", (e: { error?: { message?: string; status?: number } }) => {
      const msg = e?.error?.message ?? "";
      const status = e?.error?.status;
      // Only treat tile/style-source failures as basemap failures. A missing
      // glyph or sprite must not trigger a wholesale style swap.
      const isBasemapFailure =
        status === 404 ||
        /tiles\.openfreemap\.org|Failed to fetch|NetworkError|ERR_/i.test(msg);
      if (isBasemapFailure) swapToOfflineBasemap();
    });

    // If the style has not finished loading in time, assume the host is
    // unreachable and fall back rather than hanging on an empty canvas.
    const basemapDeadline = window.setTimeout(() => {
      if (!map.isStyleLoaded()) swapToOfflineBasemap();
    }, 8000);
    timeoutsRef.current.push(basemapDeadline);

    // ------------------------------------------------------------------
    // SILENT-FAILURE GUARD (added after DEV-151 shipped a blank map as
    // "verified"). The community layer is added inside the async "load"
    // handler. If "load" never fires — which is what happened when the
    // CARTO basemap started returning watermark tiles — the ENTIRE data
    // layer is silently skipped: page returns 200, legend populates, and
    // zero points render. There was no timeout and no error path.
    //
    // Two defences:
    //   1. addLayer is attempted once the style is ready, via a race
    //      between "load" and a short poll, so a stalled style cannot
    //      block the data.
    //   2. if the layer still isn't present after LOAD_TIMEOUT_MS, flip
    //      to the visible "degraded" state instead of failing silently.
    // ------------------------------------------------------------------
    const LOAD_TIMEOUT_MS = 6000;
    let settled = false;

    const addCommunityLayer = () => {
      // NOTE: must NOT early-return on `settled` alone. map.setStyle() wipes
      // every custom source and layer, so after a basemap fallback the
      // community layer has to be re-added. Guarding only on `settled` would
      // leave the map rendering no points while everything still looked
      // healthy — the exact silent-failure class this file exists to prevent.
      // Guard on the actual layer presence instead.
      if (!map.isStyleLoaded()) return false;
      if (map.getLayer("communities")) {
        settled = true;
        setReady(true);
        return true;
      }
      settled = false;
      try {
        map.addSource("communities", {
          type: "geojson",
          data: geojson as GeoJSON.FeatureCollection,
        });
        map.addLayer({
          id: "communities",
          type: "circle",
          source: "communities",
          paint: {
            "circle-radius": 6,
            "circle-opacity": 0.92,
            "circle-color": colorExpr("cscColor"),
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.on("mouseenter", "communities", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "communities", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", "communities", (e: MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const props = feature.properties as CommunityProperties;
          const geometry = feature.geometry as GeoJSON.Point;
          new Popup({ closeButton: true, maxWidth: "300px" })
            .setLngLat(geometry.coordinates as [number, number])
            .setHTML(popupHtml(props))
            .addTo(map);
        });
        settled = true;
        setReady(true);
        return true;
      } catch {
        return false;
      }
    };

    map.on("load", addCommunityLayer);
    // Poll rather than relying on a single event, and do NOT stop polling on
    // first success: map.setStyle() (the basemap fallback) destroys the
    // community layer, and this poll is what puts it back. Clearing it after
    // the first success would strand the fallback case with no data.
    let polls = 0;
    const poll = window.setInterval(() => {
      polls += 1;
      addCommunityLayer();
      // Give up eventually so we do not poll forever on a dead map.
      if (settled && polls > 120) window.clearInterval(poll);
    }, 250);
    const deadline = window.setTimeout(() => {
      if (!settled) {
        // Data layer never attached. Say so, loudly, in the UI.
        setDegraded(true);
      }
    }, LOAD_TIMEOUT_MS);
    timeoutsRef.current.push(poll, deadline);

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(deadline);
      timeoutsRef.current.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      timeoutsRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Mount once; the dataset is server-rendered and stable per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the source in sync if the dataset changes without a remount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("communities");
    if (source) {
      (source as GeoJSONSource).setData(geojson as GeoJSON.FeatureCollection);
    }
  }, [geojson, ready]);

  // Repaint on color-mode switch.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty(
      "communities",
      "circle-color",
      colorExpr(mode === "csc" ? "cscColor" : "cecColor"),
    );
  }, [mode, ready]);

  if (failed) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-900">
        The map could not be initialized (WebGL unavailable?). Community data
        remains available on the{" "}
        <Link className="font-medium underline" href="/communities">
          communities list
        </Link>
        .
      </div>
    );
  }

  return (
    <div>
      {basemapDegraded && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900"
        >
          <strong className="font-semibold">Basemap unavailable.</strong>{" "}
          Community data is rendering normally on a simplified background —
          roads, water and place labels are missing because the tile host could
          not be reached.
        </div>
      )}
      {degraded && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong className="font-semibold">
            Map data layer did not load.
          </strong>{" "}
          The map is showing but community points could not be drawn. This is
          usually a rendering or network problem, not missing data — the
          dataset itself is complete. Use the{" "}
          <Link className="font-medium underline" href="/communities">
            communities list
          </Link>{" "}
          for the same information.
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-neutral-300 bg-white p-1 shadow-sm">
          {(
            [
              ["csc", "CSC certification"],
              ["cec", "CEC designation"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === value
                  ? "bg-emerald-600 text-white"
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
          {LEGENDS[mode].map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full ring-1 ring-white"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div
        ref={containerRef}
        className="h-[65vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-neutral-300 shadow-sm"
      />
      <p className="mt-2 text-xs text-neutral-500">
        Click a point for a community summary and profile link. Coordinates:
        CSC portal (communities), U.S. Census 2020 Gazetteer centroids
        (CEC-only municipalities).
      </p>
    </div>
  );
}