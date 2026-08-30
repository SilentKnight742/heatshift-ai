import { afterEach, describe, expect, it, vi } from "vitest";
import { getDemoScenario, getHeatshieldValidation, runDemo, runScenario } from "@/lib/api";
import { analysisFixture, scenarioFixture } from "./fixtures";

describe("frontend API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs the default analysis with the expected method and URL", async () => {
    const result = analysisFixture();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runDemo()).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/demo", expect.objectContaining({ method: "POST" }));
  });

  it("loads the editable reference scenario", async () => {
    const scenario = scenarioFixture();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(scenario), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getDemoScenario()).resolves.toEqual(scenario);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/demo/scenario", expect.any(Object));
  });

  it("serializes custom scenarios and translates API validation details", async () => {
    const scenario = scenarioFixture();
    const success = vi.fn().mockResolvedValue(new Response(JSON.stringify(analysisFixture()), { status: 200 }));
    vi.stubGlobal("fetch", success);
    await runScenario(scenario);
    expect(JSON.parse(success.mock.calls[0][1].body)).toEqual(scenario);

    const failure = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: [{ loc: ["body", "shift", "tasks", 0], msg: "invalid window" }] }), { status: 422 }));
    vi.stubGlobal("fetch", failure);
    await expect(runScenario(scenario)).rejects.toThrow("shift → tasks → 0: invalid window");
  });

  it("fails empirical evidence requests explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(getHeatshieldValidation()).rejects.toThrow("Validation evidence failed (503)");
  });
});
