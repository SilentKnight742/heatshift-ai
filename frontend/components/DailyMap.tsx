"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJsonObject } from "geojson";
import type { LayerGroup, Map as LeafletMap, Path } from "leaflet";
import { stateBoundary } from "@/lib/us-states";
import type { DailyEvidence, DailyJob, DailyScheduleEntry, DailySite, GeoJSONGeometry } from "@/lib/api";

export interface CellSelection {
  id: string;
  longitude: number;
  latitude: number;
  apparentTemperatureC: number;
  temperatureC1500: number;
  source: string;
  jobIds: string[];
  activeJobIds: string[];
}

interface DailyMapProps {
  stateCode: string;
  sites: DailySite[];
  selectedSite: DailySite | null;
  evidence: DailyEvidence | null;
  hour: number;
  jobs: DailyJob[];
  schedule: DailyScheduleEntry[];
  selectedCellId: string | null;
  heatScale: TemperatureScale;
  onSelectSite: (siteId: string) => void;
  onSelectCell: (cell: CellSelection) => void;
  onMapPoint: (longitude: number, latitude: number) => void;
}

export interface TemperatureScale {
  minimum: number;
  maximum: number;
}

function coordinatePairs(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") return [[value[0], value[1]]];
  return value.flatMap(coordinatePairs);
}

function pointInRing(longitude: number, latitude: number, ring: number[][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > latitude) !== (y2 > latitude) && longitude < (x2 - x1) * (latitude - y1) / ((y2 - y1) || Number.EPSILON) + x1) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(longitude: number, latitude: number, geometry: GeoJSONGeometry) {
  if (geometry.type === "Polygon") return (geometry.coordinates as number[][][]).some((ring) => pointInRing(longitude, latitude, ring));
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).some((polygon) => polygon.some((ring) => pointInRing(longitude, latitude, ring)));
  return false;
}

function geometryCentre(geometry: GeoJSONGeometry): [number, number] {
  const points = coordinatePairs(geometry.coordinates);
  const totals = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
  return [totals[0] / Math.max(points.length, 1), totals[1] / Math.max(points.length, 1)];
}

function minuteOfDay(timestamp: string) {
  return Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16));
}

function overlapsHour(entry: DailyScheduleEntry | undefined, hour: number) {
  if (!entry) return false;
  const start = minuteOfDay(entry.start);
  const end = minuteOfDay(entry.end);
  return start < (hour + 1) * 60 && end > hour * 60;
}

export function temperatureForCell(evidence: DailyEvidence, cellId: string, hour: number) {
  const cell = evidence.heat_cells.find((item) => item.cell_id === cellId);
  if (!cell) return null;
  const condition = evidence.conditions.find((item) => Number(item.timestamp.slice(11, 13)) === hour) || evidence.conditions[0];
  const mean = evidence.heat_cells.reduce((total, item) => total + item.temperature_c_1500, 0) / Math.max(evidence.heat_cells.length, 1);
  return Number((condition.apparent_temperature_c + cell.temperature_c_1500 - mean).toFixed(2));
}

const HEAT_STOPS = [
  { point: 0, color: [49, 54, 149] },
  { point: .09, color: [54, 89, 180] },
  { point: .18, color: [44, 123, 182] },
  { point: .27, color: [0, 166, 202] },
  { point: .36, color: [0, 203, 188] },
  { point: .45, color: [101, 223, 155] },
  { point: .55, color: [184, 239, 131] },
  { point: .64, color: [255, 242, 122] },
  { point: .69, color: [255, 211, 78] },
  { point: .75, color: [249, 155, 61] },
  { point: .8, color: [237, 90, 54] },
  { point: .85, color: [215, 48, 39] },
  { point: .91, color: [169, 21, 74] },
  { point: 1, color: [103, 0, 31] },
];

function heatRgbForTemperature(temperature: number, scale: TemperatureScale) {
  const position = scale.maximum === scale.minimum ? .5 : Math.max(0, Math.min(1, (temperature - scale.minimum) / (scale.maximum - scale.minimum)));
  const upperIndex = HEAT_STOPS.findIndex((stop) => stop.point >= position);
  if (upperIndex <= 0) return HEAT_STOPS[0].color;
  const upper = HEAT_STOPS[upperIndex];
  const lower = HEAT_STOPS[upperIndex - 1];
  const progress = (position - lower.point) / (upper.point - lower.point);
  return lower.color.map((channel, index) => Number((channel + (upper.color[index] - channel) * progress).toFixed(1)));
}

export function heatColorForTemperature(temperature: number, scale: TemperatureScale) {
  return `rgb(${heatRgbForTemperature(temperature, scale).join(",")})`;
}

export function heatColorForCell(temperature: number, scale: TemperatureScale, withinHourPosition: number) {
  const base = heatRgbForTemperature(temperature, scale);
  const localPosition = Math.max(0, Math.min(1, withinHourPosition));
  const target = localPosition < .5 ? 255 : 24;
  const amount = localPosition < .5 ? (.5 - localPosition) * .64 : (localPosition - .5) * .44;
  const shaded = base.map((channel) => Number((channel + (target - channel) * amount).toFixed(1)));
  return `rgb(${shaded.join(",")})`;
}

export function temperatureScaleForEvidence(evidenceItems: DailyEvidence[]): TemperatureScale | null {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  evidenceItems.forEach((evidence) => {
    if (!evidence.conditions.length) return;
    const mean = evidence.heat_cells.reduce((total, cell) => total + cell.temperature_c_1500, 0) / Math.max(evidence.heat_cells.length, 1);
    const offsets = evidence.heat_cells.length ? evidence.heat_cells.map((cell) => cell.temperature_c_1500 - mean) : [0];
    const minimumOffset = Math.min(...offsets);
    const maximumOffset = Math.max(...offsets);
    evidence.conditions.forEach((condition) => {
      minimum = Math.min(minimum, condition.apparent_temperature_c + minimumOffset);
      maximum = Math.max(maximum, condition.apparent_temperature_c + maximumOffset);
    });
  });
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  let roundedMinimum = Math.floor(minimum);
  let roundedMaximum = Math.ceil(maximum);
  if (roundedMaximum - roundedMinimum < 6) {
    const centre = (roundedMinimum + roundedMaximum) / 2;
    roundedMinimum = Math.floor(centre - 3);
    roundedMaximum = Math.ceil(centre + 3);
  }
  return { minimum: roundedMinimum, maximum: roundedMaximum };
}

function burdenColor(value: number | null) {
  if (value === null) return "#9aa8a1";
  if (value < 150) return "#48be92";
  if (value < 350) return "#e5ac45";
  return "#e4674d";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}

export default function DailyMap(props: DailyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const stateLayerRef = useRef<LayerGroup | null>(null);
  const siteLayerRef = useRef<LayerGroup | null>(null);
  const cellLayerRef = useRef<LayerGroup | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const previousSiteRef = useRef<string | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  propsRef.current = props;

  const scheduleByJob = useMemo(() => new Map(props.schedule.map((entry) => [entry.job_id, entry])), [props.schedule]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;
      try {
        const map = L.map(containerRef.current, { zoomControl: false, doubleClickZoom: false, minZoom: 3, maxZoom: 19, preferCanvas: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          subdomains: "abc",
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        L.control.zoom({ position: "bottomright" }).addTo(map);
        stateLayerRef.current = L.layerGroup().addTo(map);
        siteLayerRef.current = L.layerGroup().addTo(map);
        cellLayerRef.current = L.layerGroup().addTo(map);
        markerLayerRef.current = L.layerGroup().addTo(map);
        map.on("dblclick", (event) => propsRef.current.onMapPoint(event.latlng.lng, event.latlng.lat));
        mapRef.current = map;
        leafletRef.current = L;
        setReady(true);
        requestAnimationFrame(() => map.invalidateSize());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The interactive map could not start.");
      }
    }).catch(() => setError("The interactive map library could not load."));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const group = stateLayerRef.current;
    if (!ready || !L || !map || !group) return;
    group.clearLayers();
    const boundary = L.geoJSON(stateBoundary(props.stateCode) as unknown as GeoJsonObject, {
      style: { color: "#237457", weight: 2, opacity: .75, fillColor: "#4eaa84", fillOpacity: .05 },
    }).addTo(group);
    if (!props.selectedSite) map.fitBounds(boundary.getBounds().pad(.05), { animate: true, padding: [28, 28] });
  }, [props.stateCode, props.selectedSite, ready]);

  useEffect(() => {
    const L = leafletRef.current;
    const group = markerLayerRef.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    props.sites.forEach((site) => {
      const selected = site.site_id === props.selectedSite?.site_id;
      const compact = Boolean(props.selectedSite);
      const icon = L.divIcon({
        className: "heatshift-site-marker-wrap",
        html: `<div class="heatshift-site-marker${selected ? " selected" : ""}${compact ? " compact" : ""}"><i style="background:${burdenColor(site.thermal_burden)}"></i>${compact ? "" : `<span><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(site.site_type)}</small></span>`}</div>`,
        iconSize: compact ? [44, 44] : [210, 52],
        iconAnchor: compact ? [22, 22] : [22, 26],
      });
      const marker = L.marker([site.centroid.latitude, site.centroid.longitude], { icon, riseOnHover: true, keyboard: true, title: `Open ${site.name}`, alt: `Open ${site.name}` })
        .on("click", () => propsRef.current.onSelectSite(site.site_id));
      if (compact) marker.bindTooltip(escapeHtml(site.name), { direction: "top", offset: [0, -18] });
      marker.addTo(group);
    });
  }, [props.sites, props.selectedSite?.site_id, ready]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const boundaryGroup = siteLayerRef.current;
    const cellsGroup = cellLayerRef.current;
    if (!ready || !L || !map || !boundaryGroup || !cellsGroup) return;
    boundaryGroup.clearLayers();
    cellsGroup.clearLayers();
    const site = props.selectedSite;
    if (!site) {
      previousSiteRef.current = null;
      return;
    }
    const boundary = L.geoJSON(site.geometry as unknown as GeoJsonObject, {
      style: { color: "#0f513b", weight: 3, opacity: .95, dashArray: "8 6", fillColor: "#61cfa4", fillOpacity: .04 },
    }).addTo(boundaryGroup);
    if (previousSiteRef.current !== site.site_id) {
      map.fitBounds(boundary.getBounds().pad(.16), { animate: true, duration: .7, maxZoom: 16, padding: [70, 70] });
      previousSiteRef.current = site.site_id;
    }
    if (!props.evidence) return;
    const hourlyTemperatures = props.evidence.heat_cells.map((cell) => temperatureForCell(props.evidence!, cell.cell_id, props.hour) ?? cell.apparent_temperature_c);
    const hourlyMinimum = Math.min(...hourlyTemperatures);
    const hourlyMaximum = Math.max(...hourlyTemperatures);
    props.evidence.heat_cells.forEach((cell) => {
      const temperature = temperatureForCell(props.evidence!, cell.cell_id, props.hour) ?? cell.apparent_temperature_c;
      const cellJobs = props.jobs.filter((job) => pointInGeometry(job.location.longitude, job.location.latitude, cell.geometry));
      const active = cellJobs.filter((job) => overlapsHour(scheduleByJob.get(job.job_id), props.hour));
      const selected = cell.cell_id === props.selectedCellId;
      const layer = L.geoJSON({ type: "Feature", properties: {}, geometry: cell.geometry } as unknown as GeoJsonObject, {
        style: {
          color: selected ? "#10271f" : active.length ? "#ffffff" : "rgba(22,55,42,.34)",
          weight: selected ? 5 : active.length ? 6 : 1,
          opacity: 1,
          fillColor: heatColorForCell(temperature, props.heatScale, hourlyMaximum === hourlyMinimum ? .5 : (temperature - hourlyMinimum) / (hourlyMaximum - hourlyMinimum)),
          fillOpacity: selected ? .82 : .68,
          className: active.length ? "heatshift-active-cell" : "",
        },
      });
      const [longitude, latitude] = geometryCentre(cell.geometry);
      const selection: CellSelection = {
        id: cell.cell_id,
        longitude,
        latitude,
        apparentTemperatureC: temperature,
        temperatureC1500: cell.temperature_c_1500,
        source: cell.source,
        jobIds: cellJobs.map((job) => job.job_id),
        activeJobIds: active.map((job) => job.job_id),
      };
      layer.bindTooltip(`<strong>${temperature.toFixed(2)}°C apparent</strong><br>${cellJobs.length} jobs · ${active.length} active`, { sticky: true, direction: "top", className: "heatshift-cell-tooltip" });
      layer.on("click", () => propsRef.current.onSelectCell(selection));
      layer.on("mouseover", () => layer.setStyle({ weight: selected ? 5 : 3, fillOpacity: .84 }));
      layer.on("mouseout", () => layer.setStyle({ weight: selected ? 5 : active.length ? 6 : 1, fillOpacity: selected ? .82 : .68 }));
      layer.on("add", () => requestAnimationFrame(() => layer.eachLayer((child) => {
        const element = (child as Path).getElement();
        if (!element) return;
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        element.setAttribute("data-cell-id", cell.cell_id);
        element.setAttribute("aria-label", `${cell.cell_id}: ${temperature.toFixed(2)} degrees Celsius apparent, ${cellJobs.length} jobs, ${active.length} active`);
        element.addEventListener("keydown", (event) => { const key = (event as KeyboardEvent).key; if (key === "Enter" || key === " ") propsRef.current.onSelectCell(selection); });
      })));
      layer.addTo(cellsGroup);
    });
  }, [props.evidence, props.hour, props.jobs, props.selectedCellId, props.selectedSite, ready, scheduleByJob]);

  return <div className="operations-map" aria-label="Interactive state and site operations map">
    <div ref={containerRef} className="operations-map-canvas" />
    {!ready && !error && <div className="operations-map-loading"><i /><span>Loading the interactive map…</span></div>}
    {error && <div className="operations-map-error" role="alert"><strong>Map unavailable</strong><span>{error}</span><button type="button" onClick={() => window.location.reload()}>Reload map</button></div>}
  </div>;
}
