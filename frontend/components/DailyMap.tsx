"use client";

import WeeklyMap, { type BuildingEstimate } from "@/components/WeeklyMap";
import { stateBoundary, stateCentre } from "@/lib/us-states";
import type {
  DailyCrew,
  DailyEvidence,
  DailyJob,
  DailySite,
  SiteDay,
  WeeklyCrew,
  WeeklyJob,
  WeeklySite,
} from "@/lib/api";

interface DailyMapProps {
  stateCode: string;
  mode: "portfolio" | "site";
  onMode: (mode: "portfolio" | "site") => void;
  sites: DailySite[];
  selectedSite: DailySite | null;
  evidence: DailyEvidence | null;
  hour: number;
  jobs: DailyJob[];
  crews: DailyCrew[];
  onSelectSite: (siteId: string) => void;
  onSelectJob: (jobId: string) => void;
  onSelectCell: (cell: BuildingEstimate) => void;
  onMapPoint: (longitude: number, latitude: number) => void;
}

function weeklySite(site: DailySite): WeeklySite {
  return {
    site_id: site.site_id,
    owner_id: site.owner_id,
    name: site.name,
    state_code: site.state_code,
    site_type: site.site_type,
    geometry: site.geometry,
    centroid: site.centroid,
    timezone: site.timezone,
    curated: site.curated,
    fictional_operation: true,
    data_status: site.evidence_kind === "fortyguard_cached" ? "ready" : site.workflow_stage === "site_created" ? "unavailable" : "degraded",
    evidence_week_start: site.operation_date,
    source_label: site.source_label,
    thermal_burden: site.thermal_burden,
  };
}

function emptySite(stateCode: string): WeeklySite {
  return {
    site_id: `state-${stateCode}`,
    owner_id: null,
    name: `${stateCode} operations`,
    state_code: stateCode,
    site_type: "state portfolio",
    geometry: stateBoundary(stateCode) as WeeklySite["geometry"],
    centroid: stateCentre(stateCode),
    timezone: "America/New_York",
    curated: true,
    fictional_operation: true,
    data_status: "unavailable",
    evidence_week_start: null,
    source_label: "No selected site",
    thermal_burden: null,
  };
}

export default function DailyMap(props: DailyMapProps) {
  const mappedSite = props.selectedSite ? weeklySite(props.selectedSite) : emptySite(props.stateCode);
  const mappedJobs: WeeklyJob[] = props.jobs.map((job) => ({
    ...job,
    dependencies: [],
    movable: false,
    status: "pending",
  }));
  const mappedCrews = props.crews as WeeklyCrew[];
  const mappedDay = props.evidence as unknown as SiteDay | null;

  return <WeeklyMap
    stateCode={props.stateCode}
    mode={props.mode}
    onMode={props.onMode}
    sites={props.sites.map(weeklySite)}
    selectedSite={mappedSite}
    day={mappedDay}
    hour={props.hour}
    jobs={mappedJobs}
    crews={mappedCrews}
    onSelectSite={props.onSelectSite}
    onSelectJob={props.onSelectJob}
    onSelectCrew={() => undefined}
    onSelectBuilding={props.onSelectCell}
    onMoveJob={() => undefined}
    onAssignCrew={() => undefined}
    onMapPoint={props.onMapPoint}
    readOnly
  />;
}
