"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { HeatCell, SiteDay, WeeklyCrew, WeeklyJob, WeeklySite } from "@/lib/api";
import { stateBoundary } from "@/lib/us-states";

export interface BuildingEstimate {
  id: string;
  kind?: "building" | "cell";
  longitude: number;
  latitude: number;
  apparentTemperatureC: number | null;
}

interface WeeklyMapProps {
  stateCode: string;
  mode: "portfolio" | "site";
  onMode: (mode: "portfolio" | "site") => void;
  sites: WeeklySite[];
  selectedSite: WeeklySite;
  day: SiteDay | null;
  hour: number;
  jobs: WeeklyJob[];
  crews: WeeklyCrew[];
  onSelectSite: (siteId: string) => void;
  onSelectJob: (jobId: string) => void;
  onSelectCrew: (crewId: string) => void;
  onSelectBuilding: (building: BuildingEstimate) => void;
  onMoveJob: (jobId: string, longitude: number, latitude: number) => void;
  onAssignCrew: (jobId: string, crewId: string) => void;
  onMapPoint: (longitude: number, latitude: number) => void;
}

function temperatureFor(cell: HeatCell, day: SiteDay, hour: number) {
  const condition = day.conditions.find((item) => Number(item.timestamp.slice(11, 13)) === hour) || day.conditions[0];
  const mean = day.heat_cells.reduce((total, item) => total + item.temperature_c_1500, 0) / Math.max(day.heat_cells.length, 1);
  return Number((condition.apparent_temperature_c + cell.temperature_c_1500 - mean).toFixed(2));
}

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { return false; }
}

function coordinatePairs(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") return [[value[0], value[1]]];
  return value.flatMap(coordinatePairs);
}

function pointInRing(longitude: number, latitude: number, ring: number[][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index]; const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude) && longitude < (x2 - x1) * (latitude - y1) / ((y2 - y1) || Number.EPSILON) + x1) inside = !inside;
  }
  return inside;
}

function pointInGeometry(longitude: number, latitude: number, geometry: HeatCell["geometry"]) {
  if (geometry.type === "Polygon") return (geometry.coordinates as number[][][]).some((ring) => pointInRing(longitude, latitude, ring));
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).some((polygon) => polygon.some((ring) => pointInRing(longitude, latitude, ring)));
  return false;
}

function boundsFor(collection: FeatureCollection<Geometry> | WeeklySite["geometry"], extra: number[][] = []) {
  const points = [...collection.features.flatMap((item) => coordinatePairs("coordinates" in item.geometry ? item.geometry.coordinates : [])), ...extra];
  return points.reduce((bounds, point) => ({
    west: Math.min(bounds.west, point[0]), south: Math.min(bounds.south, point[1]),
    east: Math.max(bounds.east, point[0]), north: Math.max(bounds.north, point[1]),
  }), { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity });
}

function nearestTemperature(longitude: number, latitude: number, day: SiteDay | null, hour: number) {
  if (!day?.heat_cells.length) return null;
  const intersecting = day.heat_cells.find((cell) => pointInGeometry(longitude, latitude, cell.geometry));
  if (intersecting) return temperatureFor(intersecting, day, hour);
  const nearest = day.heat_cells.reduce((best, cell) => {
    const points = coordinatePairs(cell.geometry.coordinates);
    const centre = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / Math.max(points.length, 1));
    const distance = (centre[0] - longitude) ** 2 + (centre[1] - latitude) ** 2;
    return distance < best.distance ? { cell, distance } : best;
  }, { cell: day.heat_cells[0], distance: Infinity });
  return temperatureFor(nearest.cell, day, hour);
}

function geometryCentre(geometry: HeatCell["geometry"]): [number, number] {
  const points = coordinatePairs(geometry.coordinates);
  return points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
    .map((value) => value / Math.max(points.length, 1)) as [number, number];
}

function projectedPath(geometry: Geometry, project: (longitude: number, latitude: number) => [number, number]) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.map((polygon) => polygon.map((ring) => ring.map(([longitude, latitude], index) => {
    const [x, y] = project(longitude, latitude);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join("") + "Z").join(" ")).join(" ");
}

function SvgFallback(props: WeeklyMapProps & { boundary: FeatureCollection<Geometry> }) {
  const collection = props.mode === "portfolio" ? props.boundary : props.selectedSite.geometry;
  const extra = props.mode === "portfolio" ? props.sites.map((site) => [site.centroid.longitude, site.centroid.latitude]) : props.jobs.map((job) => [job.location.longitude, job.location.latitude]);
  const bounds = boundsFor(collection, extra);
  const width = Math.max(bounds.east - bounds.west, .001);
  const height = Math.max(bounds.north - bounds.south, .001);
  const pad = 35;
  const project = (longitude: number, latitude: number): [number, number] => [pad + ((longitude - bounds.west) / width) * (1000 - pad * 2), 560 - pad - ((latitude - bounds.south) / height) * (560 - pad * 2)];
  return <svg className="weekly-map-svg" viewBox="0 0 1000 560" role="img" aria-label={props.mode === "portfolio" ? `${props.stateCode} site portfolio map fallback` : `${props.selectedSite.name} thermal field fallback`} onDoubleClick={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 1000;
    const y = (event.clientY - rect.top) / rect.height * 560;
    const longitude = bounds.west + Math.max(0, Math.min(1, (x - pad) / (1000 - pad * 2))) * width;
    const latitude = bounds.north - Math.max(0, Math.min(1, (y - pad) / (560 - pad * 2))) * height;
    props.onMapPoint(longitude, latitude);
  }}>
    <defs><pattern id="map-grid" width="55" height="55" patternUnits="userSpaceOnUse"><path d="M55 0H0V55" fill="none" stroke="#29433a" strokeWidth="1" opacity=".3" /></pattern></defs>
    <rect width="1000" height="560" fill="#0c1d20" /><rect width="1000" height="560" fill="url(#map-grid)" />
    {collection.features.map((item, index) => <path key={`boundary-${index}`} d={projectedPath(item.geometry as Geometry, project)} fill={props.mode === "portfolio" ? "#18392f" : "rgba(80,150,121,.12)"} stroke="#67e0b4" strokeWidth="2" strokeDasharray={props.mode === "site" ? "8 6" : undefined} fillRule="evenodd" />)}
    {props.mode === "site" && props.day?.heat_cells.map((cell) => {
      const temperature = temperatureFor(cell, props.day!, props.hour);
      const color = temperature < 35 ? "#63cfa7" : temperature < 38 ? "#efb65a" : temperature < 42 ? "#ef7755" : "#d83164";
      const [longitude, latitude] = geometryCentre(cell.geometry);
      const select = () => props.onSelectBuilding({ id: cell.cell_id, kind: "cell", longitude, latitude, apparentTemperatureC: temperature });
      return <path key={cell.cell_id} d={projectedPath(cell.geometry as Geometry, project)} fill={color} opacity=".72" role="button" tabIndex={0} onClick={select} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(); }}><title>{temperature.toFixed(1)}°C · HeatShift-derived hourly cell</title></path>;
    })}
    {props.mode === "portfolio" && props.sites.map((site) => {
      const [x, y] = project(site.centroid.longitude, site.centroid.latitude);
      const color = site.thermal_burden === null ? "#9aa8a1" : site.thermal_burden < 150 ? "#63cfa7" : site.thermal_burden < 350 ? "#efb65a" : "#ef7755";
      return <g key={site.site_id} className="map-site-marker" role="button" tabIndex={0} onClick={() => props.onSelectSite(site.site_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onSelectSite(site.site_id); }}><circle cx={x} cy={y} r="22" fill="transparent" /><circle cx={x} cy={y} r="17" fill="#10271f" stroke="#fff" strokeWidth="2" /><circle cx={x} cy={y} r="9" fill={color} /><text x={x + 23} y={y + 5}>{site.name}</text></g>;
    })}
    {props.mode === "site" && <>
      {(() => { const [x, y] = project(props.selectedSite.centroid.longitude, props.selectedSite.centroid.latitude); return <g><circle cx={x} cy={y} r="28" fill="rgba(93,218,176,.12)" stroke="#67e0b4" strokeWidth="2" /><text x={x + 35} y={y + 5}>Recovery zone · fictional</text></g>; })()}
      {props.crews.map((crew, index) => { const angle = index / Math.max(props.crews.length, 1) * Math.PI * 2; const [baseX, baseY] = project(props.selectedSite.centroid.longitude, props.selectedSite.centroid.latitude); const x = baseX + Math.cos(angle) * 45; const y = baseY + Math.sin(angle) * 45; return <g key={crew.crew_id} role="button" tabIndex={0} className="map-crew-marker" onClick={() => props.onSelectCrew(crew.crew_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onSelectCrew(crew.crew_id); }}><circle cx={x} cy={y} r="22" fill="transparent" /><circle cx={x} cy={y} r="12" fill="#75dab2" stroke="#10251d" strokeWidth="5" /><text x={x + 17} y={y + 4}>{crew.name}</text></g>; })}
      {props.jobs.map((job) => { const [x, y] = project(job.location.longitude, job.location.latitude); return <g key={job.job_id} className="map-job-marker" role="button" tabIndex={0} onClick={() => props.onSelectJob(job.job_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") props.onSelectJob(job.job_id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const crewId = event.dataTransfer.getData("text/crew-id"); if (crewId) props.onAssignCrew(job.job_id, crewId); }}><circle cx={x} cy={y} r="22" fill="transparent" /><circle cx={x} cy={y} r="14" fill="#fff" stroke="#172922" strokeWidth="7" /><circle cx={x} cy={y} r="7" fill={job.status === "completed" ? "#55d0a4" : job.status === "cancelled" ? "#8c9892" : "#ff8057"} /><text x={x + 19} y={y + 4}>{job.name}</text></g>; })}
    </>}
    {props.mode === "portfolio" && props.sites.length === 0 && <text className="map-empty-label" x="500" y="285" textAnchor="middle">No sites in {props.stateCode}. Double-click to define one.</text>}
  </svg>;
}

export default function WeeklyMap(props: WeeklyMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const markersRef = useRef<import("maplibre-gl").Marker[]>([]);
  const [fallback, setFallback] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const boundary = useMemo(() => stateBoundary(props.stateCode), [props.stateCode]);
  const cells = useMemo<FeatureCollection<Geometry, GeoJsonProperties>>(() => ({ type: "FeatureCollection", features: (props.day?.heat_cells || []).map((cell) => ({ type: "Feature", id: cell.cell_id, properties: { cell_id: cell.cell_id, temperature: temperatureFor(cell, props.day!, props.hour), source: "HeatShift-derived hourly interpolation" }, geometry: cell.geometry as Geometry })) }), [props.day, props.hour]);

  useEffect(() => {
    if (fallback) return;
    if (!container.current || !hasWebGL()) { setFallback(true); return; }
    let cancelled = false;
    setMapReady(false);
    void import("maplibre-gl").then((module) => {
      if (cancelled || !container.current) return;
      try {
        const map = new module.Map({ container: container.current, style: "https://tiles.openfreemap.org/styles/liberty", center: [props.selectedSite.centroid.longitude, props.selectedSite.centroid.latitude], zoom: props.mode === "portfolio" ? 5 : 13.5, attributionControl: false });
        map.addControl(new module.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new module.AttributionControl({ compact: true }), "bottom-right");
        map.on("error", (event) => { if (!map.loaded() && event.error) setFallback(true); });
        map.on("load", () => {
          map.addSource("state-boundary", { type: "geojson", data: boundary });
          map.addLayer({ id: "state-boundary-fill", type: "fill", source: "state-boundary", paint: { "fill-color": "#194c3b", "fill-opacity": props.mode === "portfolio" ? .12 : .03 } });
          map.addLayer({ id: "state-boundary-line", type: "line", source: "state-boundary", paint: { "line-color": "#327c61", "line-width": props.mode === "portfolio" ? 2 : 1 } });
          if (props.mode === "portfolio") {
            const siteData: FeatureCollection = { type: "FeatureCollection", features: props.sites.map((site) => ({ type: "Feature", geometry: { type: "Point", coordinates: [site.centroid.longitude, site.centroid.latitude] }, properties: { id: site.site_id, name: site.name, burden: site.thermal_burden ?? -1 } })) };
            map.addSource("portfolio-sites", { type: "geojson", data: siteData, cluster: true, clusterRadius: 45, clusterMaxZoom: 10 });
            map.addLayer({ id: "site-clusters", type: "circle", source: "portfolio-sites", filter: ["has", "point_count"], paint: { "circle-color": "#75dab2", "circle-radius": ["step", ["get", "point_count"], 20, 4, 26], "circle-stroke-color": "#10271f", "circle-stroke-width": 5 } });
            map.addLayer({ id: "site-cluster-count", type: "symbol", source: "portfolio-sites", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#10271f" } });
            map.addLayer({ id: "portfolio-site-points", type: "circle", source: "portfolio-sites", filter: ["!", ["has", "point_count"]], paint: { "circle-color": ["step", ["get", "burden"], "#9aa8a1", 0, "#63cfa7", 150, "#efb65a", 350, "#ef7755"], "circle-radius": 10, "circle-stroke-color": "#10271f", "circle-stroke-width": 5 } });
            map.addLayer({ id: "portfolio-site-labels", type: "symbol", source: "portfolio-sites", filter: ["!", ["has", "point_count"]], layout: { "text-field": ["get", "name"], "text-offset": [0, 1.5], "text-size": 12, "text-anchor": "top" }, paint: { "text-color": "#173429", "text-halo-color": "#fff", "text-halo-width": 2 } });
            map.on("click", "portfolio-site-points", (event) => { const id = event.features?.[0]?.properties?.id; if (id) propsRef.current.onSelectSite(String(id)); });
            map.on("click", "site-clusters", async (event) => { const clusterId = Number(event.features?.[0]?.properties?.cluster_id); const source = map.getSource("portfolio-sites") as import("maplibre-gl").GeoJSONSource; const zoom = await source.getClusterExpansionZoom(clusterId); map.easeTo({ center: event.lngLat, zoom }); });
          } else {
            map.addSource("site-boundary", { type: "geojson", data: props.selectedSite.geometry as FeatureCollection });
            map.addLayer({ id: "site-boundary-line", type: "line", source: "site-boundary", paint: { "line-color": "#67e0b4", "line-width": 2, "line-dasharray": [2, 2] } });
            if (props.day) {
              map.addSource("heatshift-cells", { type: "geojson", data: cells });
              map.addLayer({ id: "heatshift-cells-fill", type: "fill", source: "heatshift-cells", paint: { "fill-color": ["step", ["get", "temperature"], "#63cfa7", 35, "#efb65a", 38, "#ef7755", 42, "#d83164"], "fill-opacity": .72, "fill-outline-color": "rgba(255,255,255,.18)" } });
              map.on("click", "heatshift-cells-fill", (event) => { const value = event.features?.[0]?.properties?.temperature; if (value !== undefined) propsRef.current.onSelectBuilding({ id: String(event.features?.[0]?.properties?.cell_id ?? event.features?.[0]?.id ?? `cell-${event.lngLat.lng.toFixed(5)}-${event.lngLat.lat.toFixed(5)}`), kind: "cell", longitude: event.lngLat.lng, latitude: event.lngLat.lat, apparentTemperatureC: Number(value) }); });
            }
            map.on("click", (event) => { const rendered = map.queryRenderedFeatures(event.point); if (rendered.some((item) => item.layer.id === "heatshift-cells-fill")) return; const building = rendered.find((item) => item.layer.id.toLowerCase().includes("building")); const current = propsRef.current; if (building) current.onSelectBuilding({ id: String(building.id ?? `${event.lngLat.lng.toFixed(5)}-${event.lngLat.lat.toFixed(5)}`), kind: "building", longitude: event.lngLat.lng, latitude: event.lngLat.lat, apparentTemperatureC: nearestTemperature(event.lngLat.lng, event.lngLat.lat, current.day, current.hour) }); });
          }
          map.on("dblclick", (event) => { event.preventDefault(); propsRef.current.onMapPoint(event.lngLat.lng, event.lngLat.lat); });
          const target = boundsFor(props.mode === "portfolio" ? boundary : props.selectedSite.geometry);
          if (Number.isFinite(target.west)) map.fitBounds([[target.west, target.south], [target.east, target.north]], { padding: props.mode === "portfolio" ? 40 : 55, maxZoom: props.mode === "portfolio" ? 8 : 15 });
          mapRef.current = map; setMapReady(true);
        });
      } catch { setFallback(true); }
    });
    return () => { cancelled = true; markersRef.current.forEach((marker) => marker.remove()); markersRef.current = []; mapRef.current?.remove(); mapRef.current = null; };
  // Callback identities should not recreate the underlying map.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback, props.mode, props.selectedSite.site_id, props.stateCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || props.mode !== "site" || !props.day) return;
    (map.getSource("heatshift-cells") as import("maplibre-gl").GeoJSONSource | undefined)?.setData(cells);
  }, [cells, mapReady, props.day, props.mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || props.mode !== "portfolio") return;
    const source = map.getSource("portfolio-sites") as import("maplibre-gl").GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: props.sites.map((site) => ({ type: "Feature", geometry: { type: "Point", coordinates: [site.centroid.longitude, site.centroid.latitude] }, properties: { id: site.site_id, name: site.name, burden: site.thermal_burden ?? -1 } })) });
  }, [mapReady, props.mode, props.sites]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || props.mode !== "site") return;
    void import("maplibre-gl").then((module) => {
      markersRef.current.forEach((marker) => marker.remove());
      const markers: import("maplibre-gl").Marker[] = [];
      props.jobs.forEach((job) => {
        const button = document.createElement("button"); button.className = `weekly-map-marker status-${job.status}`; button.type = "button"; button.title = `${job.name} · drop an eligible crew here to assign`; button.setAttribute("aria-label", `Open ${job.name}`); button.addEventListener("click", () => props.onSelectJob(job.job_id)); button.addEventListener("dragover", (event) => event.preventDefault()); button.addEventListener("drop", (event) => { event.preventDefault(); const crewId = event.dataTransfer?.getData("text/crew-id"); if (crewId) props.onAssignCrew(job.job_id, crewId); });
        const marker = new module.Marker({ element: button, draggable: job.movable && job.status === "pending" }).setLngLat([job.location.longitude, job.location.latitude]).addTo(map);
        marker.on("dragend", () => { const point = marker.getLngLat(); props.onMoveJob(job.job_id, point.lng, point.lat); }); markers.push(marker);
      });
      const centre = [props.selectedSite.centroid.longitude, props.selectedSite.centroid.latitude] as [number, number];
      props.crews.forEach((crew, index) => { const button = document.createElement("button"); button.className = "weekly-crew-map-marker"; button.type = "button"; button.textContent = crew.name.slice(0, 2).toUpperCase(); button.title = `${crew.name} · fictional current location`; button.addEventListener("click", () => props.onSelectCrew(crew.crew_id)); markers.push(new module.Marker({ element: button }).setLngLat([centre[0] + (index - props.crews.length / 2) * .00035, centre[1] + .00035]).addTo(map)); });
      const recovery = document.createElement("button"); recovery.className = "weekly-recovery-marker"; recovery.type = "button"; recovery.title = "Recovery zone · fictional operation"; recovery.textContent = "R"; markers.push(new module.Marker({ element: recovery }).setLngLat(centre).addTo(map));
      markersRef.current = markers;
    });
  }, [mapReady, props.mode, props.jobs, props.crews, props.selectedSite.centroid, props.onAssignCrew, props.onMoveJob, props.onSelectCrew, props.onSelectJob]);

  return <section className="weekly-map-card" aria-label="Interactive operations map">
    <div className="weekly-map-head"><div><span className="eyebrow">{props.stateCode} · {props.mode === "portfolio" ? `${props.sites.length} portfolio site${props.sites.length === 1 ? "" : "s"}` : props.day?.date || "site setup"}</span><h2>{props.mode === "portfolio" ? "State operations map" : props.selectedSite.name}</h2></div><div className="map-head-actions"><div className="map-mode-switch" role="tablist"><button type="button" role="tab" aria-selected={props.mode === "portfolio"} onClick={() => props.onMode("portfolio")}>Portfolio</button><button type="button" role="tab" aria-selected={props.mode === "site"} onClick={() => props.onMode("site")}>Site</button></div>{props.mode === "site" && <span>{String(props.hour).padStart(2, "0")}:00</span>}<button type="button" onClick={() => setFallback((value) => !value)}>{fallback ? "Try vector map" : "Use SVG fallback"}</button></div></div>
    {fallback ? <SvgFallback {...props} boundary={boundary} /> : <div className="weekly-map-canvas" ref={container}><span className="map-loading">Loading vector map…</span></div>}
    <div className="weekly-map-foot"><span><i className="legend-cool" /> Cooler / lower burden</span><span><i className="legend-hot" /> Hotter / higher burden</span><span>{props.mode === "portfolio" ? "Select a site · double-click to start a new site" : "Click buildings/jobs/crews · drag eligible jobs · estimates are labeled"}</span></div>
  </section>;
}
