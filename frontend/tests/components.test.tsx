import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import AgentBriefing from "@/components/AgentBriefing";
import DecisionSummary from "@/components/DecisionSummary";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import RiskSummary from "@/components/RiskSummary";
import ShiftTimeline from "@/components/ShiftTimeline";
import SiteMap from "@/components/SiteMap";
import { analysisFixture } from "./fixtures";

describe("analysis result components", () => {
  it("renders the six result metrics without changing their meaning", () => {
    render(<RiskSummary metrics={analysisFixture().metrics} />);
    expect(screen.getByLabelText("Analysis summary").children).toHaveLength(6);
    expect(screen.getByText("78.0%")).toBeInTheDocument();
    expect(screen.getByText("1,230 → 270")).toBeInTheDocument();
    expect(screen.getByText("worker-minutes ≥ score 50")).toBeInTheDocument();
  });

  it("states the real-data and fictional-operation boundary", () => {
    render(<DecisionSummary analysis={analysisFixture()} />);
    expect(screen.getByText(/Real FortyGuard environmental evidence/)).toBeInTheDocument();
    expect(screen.getByText(/not injuries prevented/)).toBeInTheDocument();
    expect(screen.getByLabelText(/1 movable tasks rescheduled/)).toBeInTheDocument();
  });

  it("always renders the heat field as accessible SVG GeoJSON", () => {
    const analysis = analysisFixture();
    const { container } = render(<SiteMap heatmap={analysis.heatmap_geojson} site={analysis.site} tasks={analysis.tasks} schedule={analysis.optimized_schedule} />);
    expect(screen.getByRole("img", { name: /FortyGuard temperature grid/ })).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelectorAll("polygon")).toHaveLength(3);
    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByText("2 real FortyGuard cells · 100 m grid")).toBeInTheDocument();
    expect(screen.getAllByText(/Heavy cargo loading/).length).toBeGreaterThanOrEqual(1);
  });

  it("makes the agent reply prominent and identifies deterministic grounding", () => {
    const analysis = analysisFixture();
    render(<AgentBriefing agent={analysis.agent} />);
    expect(screen.getByRole("heading", { name: "What the AI recommends" })).toBeInTheDocument();
    expect(screen.getByText(analysis.agent!.explanation)).toBeInTheDocument();
    expect(screen.getByText(/only explains the validated result/)).toBeInTheDocument();
    expect(screen.getByLabelText("2 validated tool calls")).toBeInTheDocument();
    expect(screen.getByText("deterministic fallback")).toBeInTheDocument();
  });

  it("renders safe Markdown and removes raw or unsafe HTML from an agent reply", () => {
    const agent = analysisFixture().agent!;
    agent.explanation = "## Decision\n\n**Move the task.** <script>alert('x')</script> [unsafe](javascript:alert(1))";
    const { container } = render(<AgentBriefing agent={agent} />);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(screen.getByText("Move the task.").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText("alert('x')")).toBeInTheDocument(); // inert text, never executable markup
  });

  it("opens and closes the evidence trail with provenance intact", async () => {
    const user = userEvent.setup();
    render(<EvidenceDrawer analysis={analysisFixture()} />);
    await user.click(screen.getByRole("button", { name: /Open evidence drawer/ }));
    expect(screen.getByRole("heading", { name: "Evidence & provenance" })).toBeVisible();
    expect(screen.getByText("FortyGuard cached real response")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("complementary", { hidden: true })).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps manager choices local and mutually exclusive", async () => {
    const user = userEvent.setup();
    const analysis = analysisFixture();
    render(<ShiftTimeline baseline={analysis.baseline_schedule} optimized={analysis.optimized_schedule} movements={analysis.movements} />);
    const approve = screen.getByRole("button", { name: "Approve HeatShift plan" });
    const original = screen.getByRole("button", { name: "Keep original" });
    await user.click(approve);
    expect(approve).toHaveAttribute("aria-pressed", "true");
    await user.click(original);
    expect(original).toHaveAttribute("aria-pressed", "true");
    expect(approve).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/Local browser state only/)).toBeInTheDocument();
  });
});
