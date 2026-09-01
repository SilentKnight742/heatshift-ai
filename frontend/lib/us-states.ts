import { feature } from "topojson-client";
import statesTopology from "us-atlas/states-10m.json";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
  NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

type AtlasTopology = Parameters<typeof feature>[0] & {
  objects: { states: Parameters<typeof feature>[1] };
};

const allStates = feature(
  statesTopology as unknown as AtlasTopology,
  (statesTopology as unknown as AtlasTopology).objects.states,
) as unknown as FeatureCollection<Geometry>;

export function stateBoundary(stateCode: string): FeatureCollection<Geometry> {
  const target = FIPS[stateCode.toUpperCase()];
  const match = allStates.features.find((item) => String(item.id).padStart(2, "0") === target);
  return {
    type: "FeatureCollection",
    features: match ? [match as Feature<Geometry>] : [],
  };
}

export function stateCentre(stateCode: string): { longitude: number; latitude: number } {
  const boundary = stateBoundary(stateCode);
  const values: number[][] = [];
  const collect = (item: unknown) => {
    if (!Array.isArray(item)) return;
    if (item.length >= 2 && typeof item[0] === "number" && typeof item[1] === "number") values.push([item[0], item[1]]);
    else item.forEach(collect);
  };
  boundary.features.forEach((item) => { if ("coordinates" in item.geometry) collect(item.geometry.coordinates); });
  if (!values.length) return { longitude: -98.5, latitude: 39.5 };
  return {
    longitude: (Math.min(...values.map((item) => item[0])) + Math.max(...values.map((item) => item[0]))) / 2,
    latitude: (Math.min(...values.map((item) => item[1])) + Math.max(...values.map((item) => item[1]))) / 2,
  };
}
