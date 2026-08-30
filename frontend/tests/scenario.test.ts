import { describe, expect, it } from "vitest";
import { cloneScenario, createBlankScenario, minuteOfDay, parseScenarioJson, timestampFor, timeValue, validateScenario } from "@/lib/scenario";
import { scenarioFixture } from "./fixtures";

describe("scenario utilities", () => {
  it("preserves local time and timezone offsets", () => {
    expect(timeValue("2026-08-28T13:30:00-07:00")).toBe("13:30");
    expect(timestampFor("2026-08-28", "08:30", "2026-08-28T06:00:00-07:00")).toBe("2026-08-28T08:30:00-07:00");
    expect(minuteOfDay("2026-08-28T13:30:00-07:00")).toBe(810);
  });

  it("clones without retaining mutable references", () => {
    const source = scenarioFixture();
    const cloned = cloneScenario(source);
    cloned.crews[0].name = "Changed";
    expect(source.crews[0].name).toBe("Charlie Crew");
  });

  it("creates a minimal fictional scenario from pinned reference geography", () => {
    const reference = scenarioFixture();
    const created = createBlankScenario(reference, 1234);
    expect(created.shift.shift_id).toBe("scenario-1234");
    expect(created.site.site_id).toBe("desertline-yard");
    expect(created.crews).toHaveLength(1);
    expect(created.shift.tasks).toHaveLength(1);
    expect(created.shift.tasks[0]).toMatchObject({ crew_id: "crew-1234", movable: true, duration_minutes: 60 });
    expect(reference.shift.shift_id).toBe("reference-shift");
  });

  it("accepts only structurally complete HeatShift JSON exports", () => {
    const parsed = parseScenarioJson(JSON.stringify(scenarioFixture()));
    expect(parsed.environment_source).toBe("phoenix_reference");
    expect(() => parseScenarioJson("not json")).toThrow();
    expect(() => parseScenarioJson(JSON.stringify({ site: {}, crews: [], shift: { tasks: [] } }))).toThrow("not a HeatShift scenario export");
  });
});

describe("scenario validation", () => {
  it("accepts a complete valid scenario", () => {
    expect(validateScenario(scenarioFixture())).toBeNull();
  });

  it.each([
    ["blank site", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.site.name = " "; }, "Add a worksite name."],
    ["blank name", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.shift_id = ""; }, "Add a scenario name."],
    ["no crews", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.crews = []; }, "Add at least one crew."],
    ["no tasks", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.tasks = []; }, "Add at least one task."],
    ["reversed shift", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.shift_end = "2026-08-28T06:00:00-07:00"; }, "Shift end must be later than shift start."],
    ["unnamed task", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.tasks[0].name = ""; }, "Every task needs a name."],
    ["unknown crew", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.tasks[0].crew_id = "missing"; }, "Heavy cargo loading needs an assigned crew."],
    ["too early", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.tasks[0].earliest_start = "2026-08-28T14:00:00-07:00"; }, "Heavy cargo loading starts before its earliest allowed time."],
    ["too late", (scenario: ReturnType<typeof scenarioFixture>) => { scenario.shift.tasks[0].latest_finish = "2026-08-28T13:30:00-07:00"; }, "Heavy cargo loading does not finish inside its allowed window."],
  ])("rejects %s", (_name, mutate, message) => {
    const scenario = scenarioFixture();
    mutate(scenario);
    expect(validateScenario(scenario)).toBe(message);
  });

  it("rejects missing dependencies and crew overlaps", () => {
    const missing = scenarioFixture();
    missing.shift.tasks[0].dependencies = ["not-there"];
    expect(validateScenario(missing)).toContain("references a task");

    const overlap = scenarioFixture();
    overlap.shift.tasks.push({ ...cloneScenario(overlap).shift.tasks[0], task_id: "task-2", name: "Second task", scheduled_start: "2026-08-28T13:30:00-07:00" });
    expect(validateScenario(overlap)).toBe("Charlie Crew has overlapping baseline tasks.");
  });
});
