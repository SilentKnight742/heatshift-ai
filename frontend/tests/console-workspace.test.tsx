import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analysisFixture, scenarioFixture } from "./fixtures";

const apiMocks = vi.hoisted(() => ({
  getDemoScenario: vi.fn(),
  runDemo: vi.fn(),
  runScenario: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, ...apiMocks };
});

import ConsoleWorkspace from "@/components/ConsoleWorkspace";
import { SCENARIO_STORAGE_KEY } from "@/lib/scenario";

describe("browser-local scenario workspace", () => {
  beforeEach(() => {
    const scenario = scenarioFixture();
    apiMocks.getDemoScenario.mockResolvedValue({ site: scenario.site, crews: scenario.crews, shift: scenario.shift, fictional_operation: true });
    apiMocks.runDemo.mockResolvedValue(analysisFixture());
    apiMocks.runScenario.mockResolvedValue(analysisFixture());
  });

  it("loads the reference scenario and default analysis", async () => {
    render(<ConsoleWorkspace />);
    expect(await screen.findByText("Analysis complete")).toBeInTheDocument();
    expect(apiMocks.getDemoScenario).toHaveBeenCalledOnce();
    expect(apiMocks.runDemo).toHaveBeenCalledOnce();
    expect(screen.getByDisplayValue("reference-shift")).toBeInTheDocument();
  });

  it("recovers from corrupt local storage instead of bricking the console", async () => {
    localStorage.setItem(SCENARIO_STORAGE_KEY, "{not-json");
    render(<ConsoleWorkspace />);
    expect(await screen.findByText("Analysis complete")).toBeInTheDocument();
    expect(screen.getByDisplayValue("reference-shift")).toBeInTheDocument();
    expect(localStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();
    expect(apiMocks.runDemo).toHaveBeenCalledOnce();
  });

  it("creates, edits, persists, and analyzes a fictional scenario", async () => {
    const user = userEvent.setup();
    render(<ConsoleWorkspace />);
    await screen.findByText("Analysis complete");
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByDisplayValue("Untitled fictional operation")).toBeInTheDocument();
    expect(screen.getByText(/Build a scenario, then run the analysis/)).toBeInTheDocument();
    const siteName = screen.getByLabelText("Worksite name");
    await user.clear(siteName);
    await user.type(siteName, "Test Foundry");
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SCENARIO_STORAGE_KEY)!).site.name).toBe("Test Foundry"));
    await user.click(screen.getByRole("button", { name: /Run analysis/ }));
    await waitFor(() => expect(apiMocks.runScenario).toHaveBeenCalledOnce());
    expect(apiMocks.runScenario.mock.calls[0][0].site.name).toBe("Test Foundry");
    expect(await screen.findByText("Analysis complete")).toBeInTheDocument();
  });

  it("invalidates stale results and blocks an invalid shift before the API", async () => {
    const user = userEvent.setup();
    render(<ConsoleWorkspace />);
    await screen.findByText("Analysis complete");
    await user.clear(screen.getByLabelText("Worksite name"));
    expect(screen.queryByText("Analysis complete")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Run analysis/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add a worksite name.");
    expect(apiMocks.runScenario).not.toHaveBeenCalled();
  });

  it("adds crews and tasks and resets all local changes", async () => {
    const user = userEvent.setup();
    render(<ConsoleWorkspace />);
    await screen.findByText("Analysis complete");
    await user.click(screen.getByRole("tab", { name: /Crews/ }));
    await user.click(screen.getByRole("button", { name: "+ Add crew" }));
    expect(screen.getByRole("tab", { name: /Crews 2/ })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Tasks/ }));
    await user.click(screen.getByRole("button", { name: "+ Add task" }));
    expect(screen.getByRole("tab", { name: /Tasks 2/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Crews 1/ })).toBeInTheDocument());
    expect(localStorage.getItem(SCENARIO_STORAGE_KEY)).toBeNull();
    expect(apiMocks.runDemo).toHaveBeenCalledTimes(2);
  });

  it("explains why an assigned crew cannot be deleted", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    render(<ConsoleWorkspace />);
    await screen.findByText("Analysis complete");
    await user.click(screen.getByRole("tab", { name: /Crews/ }));
    const editor = screen.getByText("Charlie Crew").closest("details")!;
    await user.click(within(editor).getByRole("button", { name: "Remove crew" }));
    expect(window.alert).toHaveBeenCalledWith("Reassign this crew's tasks before removing it.");
  });

  it("imports and exports the current scenario as JSON", async () => {
    const user = userEvent.setup();
    const imported = scenarioFixture();
    imported.site.name = "Imported Yard";
    const createObjectUrl = vi.fn().mockReturnValue("blob:test");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    let downloaded = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function capture(this: HTMLAnchorElement) { downloaded = this.download; });
    render(<ConsoleWorkspace />);
    await screen.findByText("Analysis complete");
    const serialized = JSON.stringify(imported);
    const file = new File([serialized], "scenario.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => serialized });
    await user.upload(screen.getByLabelText("Import"), file);
    expect(screen.getByDisplayValue("Imported Yard")).toBeInTheDocument();
    expect(screen.getByText(/Build a scenario, then run the analysis/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(downloaded).toBe("reference-shift.json");
  });
});
