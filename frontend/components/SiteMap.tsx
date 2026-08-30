"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ScheduleItem, Site, Task } from "@/lib/api";

interface Props {
  heatmap: Record<string, unknown>;
  site: Site;
  tasks: Task[];
  schedule: ScheduleItem[];
}

export default function SiteMap({ heatmap, site, tasks, schedule }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const testCanvas = document.createElement("canvas");
    if (!testCanvas.getContext("webgl2")) {
      setUseFallback(true);
      return;
    }
    const riskByTask = Object.fromEntries(schedule.map((item) => [item.task_id, item]));
    const taskGeoJSON = {
      type: "FeatureCollection",
      features: tasks.map((task) => ({
        type: "Feature",
        properties: {
          task_id: task.task_id,
          name: task.name,
          crew: riskByTask[task.task_id]?.crew_name || task.crew_id,
          risk: riskByTask[task.task_id]?.peak_risk || 0,
          band: riskByTask[task.task_id]?.peak_band || "low",
        },
        geometry: {
          type: "Point",
          coordinates: [task.location.longitude, task.location.latitude],
        },
      })),
    };
    const coolingGeoJSON = {
      type: "Feature",
      properties: { name: "Shade Zone B" },
      geometry: {
        type: "Point",
        coordinates: [
          site.cooling_zone_coordinates.longitude,
          site.cooling_zone_coordinates.latitude,
        ],
      },
    };

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        center: [-112.0675, 33.4515],
        zoom: 14.1,
        pitch: 28,
        bearing: -8,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
              paint: { "raster-saturation": -0.8, "raster-brightness-max": 0.56, "raster-opacity": 0.62 },
            },
          ],
        },
      });
    } catch {
      setUseFallback(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.on("load", () => {
      map.addSource("heat", { type: "geojson", data: heatmap as never });
      map.addLayer({
        id: "heat-fill",
        type: "fill",
        source: "heat",
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "average_temperature"],
            41.44,
            "#f5c45b",
            41.48,
            "#f28a3d",
            41.51,
            "#ed5234",
            41.54,
            "#b7193f",
          ],
          "fill-opacity": 0.66,
          "fill-outline-color": "rgba(255,255,255,0.12)",
        },
      });
      map.addSource("site", { type: "geojson", data: site.polygon as never });
      map.addLayer({
        id: "site-outline",
        type: "line",
        source: "site",
        paint: { "line-color": "#63efd4", "line-width": 2.5, "line-dasharray": [2, 1.5] },
      });
      map.addSource("tasks", { type: "geojson", data: taskGeoJSON as never });
      map.addLayer({
        id: "tasks-glow",
        type: "circle",
        source: "tasks",
        paint: { "circle-radius": 12, "circle-color": "#0b1017", "circle-opacity": 0.64 },
      });
      map.addLayer({
        id: "tasks-points",
        type: "circle",
        source: "tasks",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "band"],
            "critical",
            "#ff4161",
            "high",
            "#ff855f",
            "moderate",
            "#f5c45b",
            "#65e9cf",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      map.addSource("cooling", { type: "geojson", data: coolingGeoJSON as never });
      map.addLayer({
        id: "cooling-zone",
        type: "circle",
        source: "cooling",
        paint: {
          "circle-radius": 13,
          "circle-color": "rgba(99,239,212,0.15)",
          "circle-stroke-color": "#63efd4",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "cooling-label",
        type: "symbol",
        source: "cooling",
        layout: {
          "text-field": "SHADE B",
          "text-size": 10,
          "text-font": ["Open Sans Bold"],
          "text-offset": [0, 2.1],
        },
        paint: { "text-color": "#d8fff7", "text-halo-color": "#071015", "text-halo-width": 1 },
      });
      map.on("click", "tasks-points", (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const node = document.createElement("div");
        node.className = "map-popup-content";
        const title = document.createElement("strong");
        title.textContent = String(feature.properties?.name || "Task");
        const detail = document.createElement("span");
        detail.textContent = `${feature.properties?.crew} · score ${feature.properties?.risk}/100`;
        node.append(title, detail);
        new maplibregl.Popup({ offset: 12, closeButton: false })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setDOMContent(node)
          .addTo(map);
      });
      map.on("mouseenter", "tasks-points", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "tasks-points", () => (map.getCanvas().style.cursor = ""));
    });

    return () => {
      try { map.remove(); } catch { /* Map may have failed during GPU initialization. */ }
    };
  }, [heatmap, site, tasks, schedule]);

  const fallbackFeatures = ((heatmap.features as Array<{
    properties: { average_temperature: number };
    geometry: { coordinates: number[][][] };
  }>) || []);
  const riskByTask = Object.fromEntries(schedule.map((item) => [item.task_id, item]));
  const project = ([longitude, latitude]: number[]) => ({
    x: ((longitude + 112.076) / 0.017) * 1000,
    y: 470 - ((latitude - 33.444) / 0.015) * 470,
  });
  const heatColor = (temperature: number) => {
    if (temperature >= 41.515) return "#bb2940";
    if (temperature >= 41.5) return "#e94f3d";
    if (temperature >= 41.485) return "#f18442";
    return "#efbd58";
  };

  return (
    <section className="panel map-panel">
      <div className="map-header-overlay">
        <div>
          <span className="eyebrow">FortyGuard thermal field</span>
          <h2>DesertLine site map</h2>
        </div>
        <span className="replay-chip"><i /> Historical replay · 15:00</span>
      </div>
      {useFallback ? (
        <div className="map-canvas fallback-map" aria-label="Phoenix worksite heatmap rendered without WebGL">
          <svg viewBox="0 0 1000 470" role="img" aria-label="FortyGuard temperature grid and worksite task locations">
            <defs>
              <pattern id="site-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,.045)" strokeWidth="1" /></pattern>
              <filter id="point-glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <rect width="1000" height="470" fill="#0b171e" />
            <rect width="1000" height="470" fill="url(#site-grid)" />
            {fallbackFeatures.map((feature, index) => {
              const points = feature.geometry.coordinates[0].map((coordinate) => {
                const point = project(coordinate);
                return `${point.x},${point.y}`;
              }).join(" ");
              return <polygon key={index} points={points} fill={heatColor(feature.properties.average_temperature)} stroke="rgba(255,255,255,.13)" strokeWidth=".6" opacity=".77" />;
            })}
            <rect x="52" y="42" width="895" height="387" fill="none" stroke="#63efd4" strokeWidth="2" strokeDasharray="8 5" opacity=".75" />
            {tasks.map((task, index) => {
              const point = project([task.location.longitude, task.location.latitude]);
              const band = riskByTask[task.task_id]?.peak_band;
              const color = band === "critical" ? "#ff4868" : band === "high" ? "#ff8858" : band === "moderate" ? "#f4c45c" : "#63efd4";
              return (
                <g key={task.task_id} transform={`translate(${point.x} ${point.y})`}>
                  <circle r="14" fill="rgba(6,14,19,.75)" />
                  <circle r="7" fill={color} stroke="#fff" strokeWidth="1.5" filter="url(#point-glow)" />
                  <text x="12" y="-10" fill="#edf2ee" fontSize="12" fontWeight="700">{String(index + 1).padStart(2, "0")} · {task.name}</text>
                  <text x="12" y="5" fill="#a6b7bb" fontSize="9">score {riskByTask[task.task_id]?.peak_risk || 0}/100</text>
                </g>
              );
            })}
            {(() => {
              const shade = project([site.cooling_zone_coordinates.longitude, site.cooling_zone_coordinates.latitude]);
              return <g transform={`translate(${shade.x} ${shade.y})`}><circle r="17" fill="rgba(99,239,212,.13)" stroke="#63efd4" strokeWidth="2" /><text x="23" y="4" fill="#bffcef" fontSize="11" fontWeight="700">SHADE B</text></g>;
            })()}
          </svg>
          <span className="fallback-chip">GPU map fallback · real GeoJSON</span>
        </div>
      ) : (
        <div className="map-canvas" ref={containerRef} aria-label="Phoenix worksite heatmap" />
      )}
      <div className="map-legend">
        <span>41.44°C</span><i className="heat-gradient" /><span>41.54°C</span>
      </div>
      <div className="map-caption">
        <span><i className="dot task-dot" /> task location</span>
        <span><i className="dot shade-dot" /> Shade Zone B</span>
        <span>198 real FortyGuard cells · 100 m grid</span>
      </div>
    </section>
  );
}
