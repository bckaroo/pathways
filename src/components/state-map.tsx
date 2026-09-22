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
          sources: {
            basemap: {
              type: "raster",
              tiles: [
                "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
                "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
              ],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            },
          },
          layers: [{ id: "basemap", type: "raster", source: "basemap" }],
        },
        center: [-75.45, 42.93],
        zoom: 5.9,
        minZoom: 5,
        maxZoom: 14,
        attributionControl: { compact: false },
      });
    } catch {
      setFailed(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
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
      setReady(true);
    });

    return () => {
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