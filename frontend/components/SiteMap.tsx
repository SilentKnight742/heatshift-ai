"use client";

import type { ScheduleItem, Site, Task } from "@/lib/api";

interface Props {
  heatmap: Record<string, unknown>;
  site: Site;
  tasks: Task[];
  schedule: ScheduleItem[];
}

interface PolygonFeature {
  properties?: { average_temperature?: number };
  geometry?: { type?: string; coordinates?: number[][][] };
}

const WIDTH = 1000;
const HEIGHT = 520;
const PADDING = 44;

export default function SiteMap({ heatmap, site, tasks, schedule }: Props) {
  const heatFeatures = (heatmap.features as PolygonFeature[] | undefined) ?? [];
  const siteFeatures = (site.polygon.features as PolygonFeature[] | undefined) ?? [];
  const riskByTask = Object.fromEntries(schedule.map((item) => [item.task_id, item]));
  const coordinates: number[][] = [];

  for (const feature of [...heatFeatures, ...siteFeatures]) {
    for (const coordinate of feature.geometry?.coordinates?.[0] ?? []) coordinates.push(coordinate);
  }
  for (const task of tasks) coordinates.push([task.location.longitude, task.location.latitude]);
  coordinates.push([site.cooling_zone_coordinates.longitude, site.cooling_zone_coordinates.latitude]);

  const longitudes = coordinates.map((point) => point[0]);
  const latitudes = coordinates.map((point) => point[1]);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeRange = Math.max(maxLongitude - minLongitude, 0.001);
  const latitudeRange = Math.max(maxLatitude - minLatitude, 0.001);
  const project = ([longitude, latitude]: number[]) => ({
    x: PADDING + ((longitude - minLongitude) / longitudeRange) * (WIDTH - PADDING * 2),
    y: HEIGHT - PADDING - ((latitude - minLatitude) / latitudeRange) * (HEIGHT - PADDING * 2),
  });

  const temperatures = heatFeatures.map((feature) => feature.properties?.average_temperature).filter((value): value is number => typeof value === "number");
  const minTemperature = temperatures.length ? Math.min(...temperatures) : 0;
  const maxTemperature = temperatures.length ? Math.max(...temperatures) : 0;
  const heatColor = (temperature = minTemperature) => {
    const ratio = (temperature - minTemperature) / Math.max(maxTemperature - minTemperature, 0.001);
    if (ratio >= .75) return "#b52b4a";
    if (ratio >= .5) return "#d94a3d";
    if (ratio >= .25) return "#e87942";
    return "#d8ad55";
  };
  const points = (feature: PolygonFeature) => (feature.geometry?.coordinates?.[0] ?? []).map((coordinate) => {
    const point = project(coordinate);
    return `${point.x},${point.y}`;
  }).join(" ");
  const shade = project([site.cooling_zone_coordinates.longitude, site.cooling_zone_coordinates.latitude]);

  return (
    <section className="panel map-panel">
      <div className="map-header-overlay">
        <div><span className="eyebrow">FortyGuard thermal field</span><h2>{site.name}</h2></div>
        <span className="replay-chip"><i /> Historical replay · 15:00</span>
      </div>
      <div className="map-canvas fallback-map" aria-label="Worksite heatmap rendered from real GeoJSON">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="FortyGuard temperature grid, worksite boundary, and task locations">
          <defs>
            <pattern id="site-grid" width="46" height="46" patternUnits="userSpaceOnUse"><path d="M 46 0 L 0 0 0 46" fill="none" stroke="rgba(255,255,255,.045)" strokeWidth="1" /></pattern>
            <filter id="point-glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill="#0b171e" /><rect width={WIDTH} height={HEIGHT} fill="url(#site-grid)" />
          {heatFeatures.map((feature, index) => <polygon key={`heat-${index}`} points={points(feature)} fill={heatColor(feature.properties?.average_temperature)} stroke="rgba(255,255,255,.13)" strokeWidth=".6" opacity=".82"><title>{feature.properties?.average_temperature?.toFixed(3)}°C</title></polygon>)}
          {siteFeatures.map((feature, index) => <polygon key={`site-${index}`} points={points(feature)} fill="none" stroke="#63efd4" strokeWidth="2.5" strokeDasharray="9 6" opacity=".84" />)}
          {tasks.map((task, index) => {
            const point = project([task.location.longitude, task.location.latitude]);
            const risk = riskByTask[task.task_id];
            const color = risk?.peak_band === "critical" ? "#ff4868" : risk?.peak_band === "high" ? "#ff8858" : risk?.peak_band === "moderate" ? "#f4c45c" : "#63efd4";
            const anchor = point.x > WIDTH * .72 ? "end" : "start";
            const labelX = anchor === "end" ? -13 : 13;
            return <g key={task.task_id} transform={`translate(${point.x} ${point.y})`}><title>{task.name} · {risk?.crew_name ?? task.crew_id} · score {risk?.peak_risk ?? 0}/100</title><circle r="14" fill="rgba(6,14,19,.78)" /><circle r="7" fill={color} stroke="#fff" strokeWidth="1.5" filter="url(#point-glow)" /><text x={labelX} y="-9" textAnchor={anchor} fill="#f3f7f5" fontSize="11" fontWeight="700">{String(index + 1).padStart(2, "0")} · {task.name}</text><text x={labelX} y="6" textAnchor={anchor} fill="#b5c5c0" fontSize="9">score {risk?.peak_risk ?? 0}/100</text></g>;
          })}
          <g transform={`translate(${shade.x} ${shade.y})`}><circle r="17" fill="rgba(99,239,212,.13)" stroke="#63efd4" strokeWidth="2" /><text x="23" y="4" fill="#bffcef" fontSize="11" fontWeight="700">SHADE / COOLING</text></g>
        </svg>
        <span className="fallback-chip">Universal renderer · real GeoJSON</span>
      </div>
      <div className="map-legend"><span>{minTemperature.toFixed(2)}°C</span><i className="heat-gradient" /><span>{maxTemperature.toFixed(2)}°C</span></div>
      <div className="map-caption"><span><i className="dot task-dot" /> task location</span><span><i className="dot shade-dot" /> cooling zone</span><span>{heatFeatures.length} real FortyGuard cells · 100 m grid</span></div>
    </section>
  );
}
