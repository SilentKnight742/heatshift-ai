import type { ScenarioPayload } from "@/lib/api";

export const SCENARIO_STORAGE_KEY = "heatshift-scenario-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPoint(value: unknown): boolean {
  return isRecord(value) && typeof value.longitude === "number" && typeof value.latitude === "number";
}

export function parseScenarioJson(text: string): ScenarioPayload {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || !isRecord(value.site) || !isRecord(value.shift)) {
    throw new Error("This file is not a HeatShift scenario export.");
  }
  const site = value.site;
  const shift = value.shift;
  const crews = value.crews;
  const tasks = shift.tasks;
  const validSite = typeof site.site_id === "string"
    && typeof site.name === "string"
    && isRecord(site.polygon)
    && typeof site.timezone === "string"
    && typeof site.surface_type === "string"
    && isPoint(site.cooling_zone_coordinates);
  const validShift = typeof shift.shift_id === "string"
    && typeof shift.date === "string"
    && typeof shift.timezone === "string"
    && typeof shift.shift_start === "string"
    && typeof shift.shift_end === "string"
    && Array.isArray(tasks)
    && tasks.every((task) => isRecord(task)
      && typeof task.task_id === "string"
      && typeof task.name === "string"
      && typeof task.crew_id === "string"
      && isPoint(task.location)
      && typeof task.duration_minutes === "number"
      && typeof task.scheduled_start === "string"
      && typeof task.earliest_start === "string"
      && typeof task.latest_finish === "string"
      && typeof task.movable === "boolean"
      && Array.isArray(task.dependencies));
  const validCrews = Array.isArray(crews) && crews.every((crew) => isRecord(crew)
    && typeof crew.crew_id === "string"
    && typeof crew.name === "string"
    && typeof crew.worker_count === "number");
  if (!validSite || !validShift || !validCrews) {
    throw new Error("This file is not a HeatShift scenario export.");
  }
  return { ...(value as unknown as ScenarioPayload), environment_source: "phoenix_reference" };
}

export function cloneScenario(value: ScenarioPayload): ScenarioPayload {
  return JSON.parse(JSON.stringify(value)) as ScenarioPayload;
}

export function timeValue(timestamp: string): string {
  return timestamp.slice(11, 16);
}

export function timestampFor(date: string, time: string, source: string): string {
  const offset = source.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] ?? "-07:00";
  return `${date}T${time}:00${offset}`;
}

export function minuteOfDay(timestamp: string): number {
  const [hour, minute] = timeValue(timestamp).split(":").map(Number);
  return hour * 60 + minute;
}

export function validateScenario(scenario: ScenarioPayload): string | null {
  if (!scenario.site.name.trim()) return "Add a worksite name.";
  if (!scenario.shift.shift_id.trim()) return "Add a scenario name.";
  if (scenario.crews.length === 0) return "Add at least one crew.";
  if (scenario.shift.tasks.length === 0) return "Add at least one task.";
  const shiftStart = minuteOfDay(scenario.shift.shift_start);
  const shiftEnd = minuteOfDay(scenario.shift.shift_end);
  if (shiftStart >= shiftEnd) return "Shift end must be later than shift start.";
  const crewIds = new Set(scenario.crews.map((crew) => crew.crew_id));
  const taskById = new Map(scenario.shift.tasks.map((task) => [task.task_id, task]));
  for (const task of scenario.shift.tasks) {
    if (!task.name.trim()) return "Every task needs a name.";
    if (!crewIds.has(task.crew_id)) return `${task.name} needs an assigned crew.`;
    const scheduled = minuteOfDay(task.scheduled_start);
    const earliest = minuteOfDay(task.earliest_start);
    const latest = minuteOfDay(task.latest_finish);
    if (scheduled < earliest) return `${task.name} starts before its earliest allowed time.`;
    if (scheduled + task.duration_minutes > latest) return `${task.name} does not finish inside its allowed window.`;
    if (scheduled < shiftStart || scheduled + task.duration_minutes > shiftEnd) return `${task.name} falls outside the shift.`;
    for (const dependencyId of task.dependencies) {
      const dependency = taskById.get(dependencyId);
      if (!dependency) return `${task.name} references a task that no longer exists.`;
      if (minuteOfDay(dependency.scheduled_start) + dependency.duration_minutes > scheduled) return `${task.name} starts before ${dependency.name} finishes.`;
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasDependencyCycle = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    const cyclic = (taskById.get(taskId)?.dependencies ?? []).some(hasDependencyCycle);
    visiting.delete(taskId);
    visited.add(taskId);
    return cyclic;
  };
  if (scenario.shift.tasks.some((task) => hasDependencyCycle(task.task_id))) return "Task dependencies contain a cycle.";

  for (const crew of scenario.crews) {
    const tasks = scenario.shift.tasks
      .filter((task) => task.crew_id === crew.crew_id)
      .sort((left, right) => minuteOfDay(left.scheduled_start) - minuteOfDay(right.scheduled_start));
    for (let index = 1; index < tasks.length; index += 1) {
      const previous = tasks[index - 1];
      const current = tasks[index];
      if (minuteOfDay(previous.scheduled_start) + previous.duration_minutes > minuteOfDay(current.scheduled_start)) return `${crew.name} has overlapping baseline tasks.`;
    }
  }
  return null;
}

export function createBlankScenario(reference: ScenarioPayload, now = Date.now()): ScenarioPayload {
  const next = cloneScenario(reference);
  const crewId = `crew-${now}`;
  next.site.name = "Untitled fictional operation";
  next.site.surface_type = "paved outdoor worksite";
  next.shift.shift_id = `scenario-${now}`;
  next.crews = [{
    crew_id: crewId,
    name: "Crew 1",
    worker_count: 1,
    acclimatization_status: "acclimatized",
    ppe_level: "low",
    default_workload: "moderate",
  }];
  next.shift.tasks = [{
    task_id: `task-${now}`,
    name: "New task",
    crew_id: crewId,
    location: { ...next.site.cooling_zone_coordinates },
    duration_minutes: 60,
    workload: "moderate",
    scheduled_start: timestampFor(next.shift.date, "08:00", next.shift.shift_start),
    earliest_start: timestampFor(next.shift.date, "06:00", next.shift.shift_start),
    latest_finish: timestampFor(next.shift.date, "16:00", next.shift.shift_end),
    movable: true,
    dependencies: [],
    shaded: false,
  }];
  return next;
}
