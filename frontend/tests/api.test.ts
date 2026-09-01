import { afterEach, describe, expect, it, vi } from "vitest";
import { getAnonymousSession, getDemoScenario, getHeatshieldValidation, runDemo, runScenario } from "@/lib/api";
import { analysisFixture, scenarioFixture } from "./fixtures";

describe("frontend API client", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    vi.unstubAllGlobals();
  });

  it("single-flights concurrent anonymous session creation", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "session-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      user: { id: "workspace-a" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([getAnonymousSession(), getAnonymousSession()]);

    expect(first).toEqual(second);
    expect(first.workspaceId).toBe("workspace-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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
