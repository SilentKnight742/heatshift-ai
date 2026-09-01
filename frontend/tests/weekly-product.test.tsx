import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WeeklyMap from "@/components/WeeklyMap";
import { Markdown, SiteGeometrySketch } from "@/components/WeeklyConsole";
import type { SiteDay, WeeklySite } from "@/lib/api";

const site: WeeklySite = {
  site_id: "site-test", owner_id: null, name: "Test yard", state_code: "AZ", site_type: "yard",
  geometry: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-112.1, 33.4], [-112, 33.4], [-112, 33.5], [-112.1, 33.5], [-112.1, 33.4]]] } }] },
  centroid: { longitude: -112.05, latitude: 33.45 }, timezone: "America/Phoenix", curated: true,
  fictional_operation: true, data_status: "ready", evidence_week_start: "2024-07-15", source_label: "Test evidence", thermal_burden: 120,
};

const day: SiteDay = {
  date: "2024-07-15", heatmap_activity_id: "heat-1", environmental_activity_id: "env-1", integrity_sha256: "abc", satellite_context: {},
  conditions: [{ timestamp: "2024-07-15T15:00:00-07:00", temperature_c: 40, apparent_temperature_c: 43, wet_bulb_temperature_c: 25, relative_humidity_percent: 30, solar_irradiance_ghi_wm2: 700, source: "FortyGuard", activity_id: "env-1" }],
  heat_cells: [{ cell_id: "cell-1", geometry: site.geometry.features[0].geometry, temperature_c_1500: 41, apparent_temperature_c: 43, source: "FortyGuard" }],
};

describe("weekly product components", () => {
  it("renders GFM while keeping raw HTML and unsafe links inert", () => {
    const { container } = render(<Markdown>{"## Decision\n\n- **Move early**\n- [bad](javascript:alert(1))\n\n<script>bad()</script>"}</Markdown>);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(screen.getByText("Move early").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("supports click-drawn polygon vertices on the real state outline", () => {
    const onPoints = vi.fn();
    render(<SiteGeometrySketch stateCode="AZ" mode="polygon" longitude={-112} latitude={33.4} radius={500} points={[]} onCentre={vi.fn()} onPoints={onPoints} />);
    const map = screen.getByRole("img", { name: "Draw a polygon inside AZ" });
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 560, bottom: 270, width: 560, height: 270, toJSON: () => ({}) });
    fireEvent.click(map, { clientX: 280, clientY: 135 });
    expect(onPoints).toHaveBeenCalledTimes(1);
    expect(onPoints.mock.calls[0][0]).toHaveLength(1);
  });

  it("automatically exposes the SVG/GeoJSON thermal fallback without WebGL", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onSelectBuilding = vi.fn();
    const { container } = render(<WeeklyMap stateCode="AZ" mode="site" onMode={vi.fn()} sites={[site]} selectedSite={site} day={day} hour={15} jobs={[]} crews={[]} onSelectSite={vi.fn()} onSelectJob={vi.fn()} onSelectCrew={vi.fn()} onSelectBuilding={onSelectBuilding} onMoveJob={vi.fn()} onAssignCrew={vi.fn()} onMapPoint={vi.fn()} />);
    expect(await screen.findByRole("img", { name: "Test yard thermal field fallback" })).toBeInTheDocument();
    expect(container.querySelector("title")?.textContent).toBe("43.0°C · HeatShift-derived hourly cell");
    fireEvent.click(container.querySelector('path[role="button"]')!);
    expect(onSelectBuilding).toHaveBeenCalledWith(expect.objectContaining({ id: "cell-1", kind: "cell", apparentTemperatureC: 43 }));
  });
});
