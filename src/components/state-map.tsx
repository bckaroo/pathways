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
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import NY_FRAME from "@/lib/ny-frame.json";
import { setWorkerUrl } from "maplibre-gl";

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
        style: {
          version: 8,
          // SELF-HOSTED, KEYLESS BASEMAP.
          //
          // This previously used CARTO's keyless raster tiles at
          // basemaps.cartocdn.com. CARTO changed policy and now returns a
          // 256x256 "API KEY REQUIRED" watermark PNG for keyless requests —
          // as HTTP 200, so nothing looked broken to a status check while
          // the map rendered blank. The openstreetmap.org fallback was also
          // rejected (403 tile usage policy), as was StadiaMaps (401).
          //
          // For a self-hostable public-good, depending on a third-party key
          // per deployment is the wrong architecture: every municipality
          // would need their own key and the map would break on any provider
          // policy change. So the basemap is now:
          //   - a flat background colour from the style spec, plus
          //   - /ny-frame.geojson, a small state-outline polygon generated
          //     from the municipality centroids already in our database.
          //
          // No external tile requests, no key, works offline. The frame is a
          // visual spatial reference, not a survey boundary (see README).
          sources: {
            "ny-frame": {
              type: "geojson",
              // INLINE, NOT A FETCH. Imported as a module rather than fetched
              // from /ny-frame.geojson.
              //
              // Why: fetching the URL never worked. The source was created but
              // stayed at loaded=false forever, no error event fired, and no
              // network request was ever issued — so the style's "load" event
              // never completed and the entire community layer was skipped
              // silently. A 538-byte static polygon has no business making a
              // network round-trip anyway: inlining removes the failure mode
              // entirely and works offline by construction.
              data: NY_FRAME as GeoJSON.FeatureCollection,
            },
          },
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#f4f6f9" },
            },
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
        },
        center: [-75.45, 42.93],
        zoom: 5.9,
        minZoom: 5,
        maxZoom: 14,
        attributionControl: false,
      });
    } catch {
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // Dev-only handle for the rendered-map smoke test
    // (scripts/smoke-map.mjs). Without this, an automated check can only
    // sample canvas pixels — it cannot assert that the source loaded or that
    // queryRenderedFeatures() returns features. Not exposed in production.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __pathwaysMap?: MapLibreMap }).__pathwaysMap = map;
    }

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
      if (settled || !map.isStyleLoaded()) return false;
      if (map.getLayer("communities")) { settled = true; return true; }
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
    // Poll as a fallback: some basemap failures leave the style loaded but
    // the load event unhelpfully delayed or dropped.
    const poll = window.setInterval(() => {
      if (addCommunityLayer()) window.clearInterval(poll);
    }, 250);
    const deadline = window.setTimeout(() => {
      window.clearInterval(poll);
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