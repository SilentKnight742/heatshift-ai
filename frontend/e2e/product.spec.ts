import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
  await page.route("**/api/daily/provider-status*", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ state: "available", live_available: true, fallback_active: false, credits_remaining: 500000, checked_at: "2026-09-18T00:00:00Z", message: "FortyGuard responded." }),
  }));
});

async function openConsole(page: Page) {
  await page.goto("/console");
  await expect(page.getByRole("tab", { name: /All sites/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Arizona operations")).toBeVisible();
}

async function openPhoenix(page: Page) {
  await openConsole(page);
  await page.getByRole("tab", { name: /DesertLine Logistics Yard.*Analysis ready/ }).click();
  await expect(page.getByLabel("Hourly environmental conditions")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Operational briefing" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Exposure reduction/ })).toBeVisible();
}

test("homepage explains the daily product, metrics, evidence and limits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "full copy journey runs once");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "The heat-aware operating plan." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Try the console/ })).toHaveClass(/secondary-link/);
  await expect(page.getByRole("link", { name: /View the research/ })).toHaveClass(/secondary-link/);
  await expect(page.getByRole("heading", { name: "Site Thermal Burden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crew Exposure Load" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational Disruption" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the metrics mean" })).toBeVisible();
  await expect(page.getByText(/workers × minutes where the task-hour score is 50 or higher/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /higher HeatShift scores correspond/ })).toBeVisible();
  await expect(page.getByText("One earlier one-day example")).toHaveCount(0);
  await expect(page.getByText("Three data layers, clearly separated.")).toHaveCount(0);
  await expect(page.locator(".section-number")).toHaveCount(0);
  await expect(page.getByText("A one-day, site-level operations simulator")).toBeVisible();
  await page.getByRole("link", { name: /Open the HeatShift console/ }).click();
  await expect(page).toHaveURL(/\/console$/);
});

test("one persistent map supports state sites, auto-zoom, hourly cells and contextual results", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await openConsole(page);
  await expect(page.getByRole("link", { name: "Homepage" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Guide/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reset defaults/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Example" })).toHaveCount(0);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  if (testInfo.project.name !== "mobile-chromium") {
    const mapBeforeCollapse = await page.locator(".map-console-main").boundingBox();
    await page.getByRole("button", { name: "Collapse setup panel" }).click();
    await expect(page.locator(".map-console-shell")).toHaveClass(/sidebar-collapsed/);
    await expect(page.getByRole("button", { name: "Expand setup panel" })).toBeVisible();
    await page.waitForTimeout(320);
    const mapAfterCollapse = await page.locator(".map-console-main").boundingBox();
    expect(mapAfterCollapse!.width).toBeGreaterThan(mapBeforeCollapse!.width + 250);
    await page.getByRole("button", { name: "Expand setup panel" }).click();
    await expect(page.locator(".map-console-shell")).not.toHaveClass(/sidebar-collapsed/);
  }
  await expect(page.getByRole("tab", { name: /DesertLine Logistics Yard.*Analysis ready/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Portfolio" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Site", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: /DesertLine Logistics Yard.*Analysis ready/ }).click();
  await expect(page.getByText("Three-step flow")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Operational briefing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analysis results" })).toBeVisible();
  const briefingPanel = page.locator(".map-floating-briefing");
  const briefingBefore = await briefingPanel.boundingBox();
  const briefingPanelHandle = await page.getByRole("button", { name: "Move AI briefing", exact: true }).boundingBox();
  expect(briefingBefore).not.toBeNull();
  expect(briefingPanelHandle).not.toBeNull();
  expect(briefingBefore!.width).toBeGreaterThan(testInfo.project.name === "mobile-chromium" ? 370 : 480);
  expect(briefingBefore!.height).toBeGreaterThan(350);
  const metricsDockBefore = await page.locator(".map-metrics-dock").boundingBox();
  expect(metricsDockBefore).not.toBeNull();
  expect(briefingBefore!.y + briefingBefore!.height).toBeLessThan(metricsDockBefore!.y);
  await page.getByRole("button", { name: "Collapse AI briefing" }).click();
  await expect(briefingPanel).toHaveClass(/collapsed/);
  await expect(page.getByRole("heading", { name: "Decision" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand AI briefing" }).click();
  await expect(briefingPanel).toHaveClass(/expanded/);
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible();
  if (testInfo.project.name !== "mobile-chromium") {
    await page.mouse.move(briefingPanelHandle!.x + briefingPanelHandle!.width / 2, briefingPanelHandle!.y + briefingPanelHandle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(briefingPanelHandle!.x + briefingPanelHandle!.width / 2, briefingPanelHandle!.y + briefingPanelHandle!.height / 2 - 35, { steps: 5 });
    await page.mouse.up();
    const briefingPanelAfter = await briefingPanel.boundingBox();
    expect(briefingPanelAfter!.y).toBeLessThan(briefingBefore!.y - 20);
  }
  await expect(page.getByText("Cached FortyGuard evidence", { exact: true })).toBeVisible();
  await expect(page.locator("[data-cell-id]").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.locator(".heatshift-active-cell").count()).toBeGreaterThan(0);
  await expect(page.getByLabel(/Arizona apparent-temperature scale from .* degrees Celsius/)).toBeVisible();
  const stateScaleBefore = await page.locator(".map-heat-scale").textContent();
  await expect(page.getByRole("tab", { name: "HeatShift" })).toHaveAttribute("aria-selected", "true");
  const cellColorsAt15 = await page.locator("[data-cell-id]").evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).fill));
  expect(new Set(cellColorsAt15).size).toBeGreaterThan(4);
  const cellColorAt15 = await page.locator("[data-cell-id]").first().evaluate((cell) => getComputedStyle(cell).fill);
  await page.getByLabel("Selected local hour").fill("12");
  await expect(page.getByText("12:00", { exact: true })).toBeVisible();
  const cellColorAt12 = await page.locator("[data-cell-id]").first().evaluate((cell) => getComputedStyle(cell).fill);
  expect(cellColorAt12).not.toBe(cellColorAt15);
  expect(await page.locator(".map-heat-scale").textContent()).toBe(stateScaleBefore);
  await page.getByRole("tab", { name: "Original" }).focus();
  await page.getByRole("tab", { name: "Original" }).press("Enter");
  await expect(page.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");

  const populatedCell = page.locator('[data-cell-id]:not([aria-label*=" 0 jobs,"])').first();
  await expect(populatedCell).toBeVisible();
  await populatedCell.focus();
  await populatedCell.press("Enter");
  await expect(page.getByText("Selected 100 m cell")).toBeVisible();
  await expect(page.getByRole("heading", { name: /\d+\.\d{2}°C apparent/ })).toBeVisible();
  await expect(page.getByText("Operations in this cell")).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();

  const exposureCard = page.getByRole("button", { name: /Exposure reduction/ });
  await exposureCard.click();
  await expect(page.getByRole("heading", { name: "Exposure reduction" })).toBeVisible();
  await expect(page.getByText(/threshold-dependent/i)).toBeVisible();
  await expect(exposureCard).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Collapse AI briefing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible();
  const analyticsPanelOpen = await page.locator(".map-floating-analytics").boundingBox();
  const briefingPanelOpen = await briefingPanel.boundingBox();
  expect(analyticsPanelOpen).not.toBeNull();
  expect(briefingPanelOpen).not.toBeNull();
  if (testInfo.project.name === "mobile-chromium") {
    expect(analyticsPanelOpen!.y + analyticsPanelOpen!.height).toBeLessThanOrEqual(briefingPanelOpen!.y + 1);
  } else {
    expect(analyticsPanelOpen!.x + analyticsPanelOpen!.width).toBeLessThanOrEqual(briefingPanelOpen!.x + 1);
  }
  const openExposureColor = await exposureCard.evaluate((element) => getComputedStyle(element).backgroundColor);
  const closedFixedColor = await page.getByRole("button", { name: /Fixed jobs preserved/ }).evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(openExposureColor).not.toBe(closedFixedColor);
  await exposureCard.click();
  await expect(page.getByRole("heading", { name: "Exposure reduction" })).toHaveCount(0);
  await expect(exposureCard).toHaveAttribute("aria-expanded", "false");
  const fixedCard = page.getByRole("button", { name: /Fixed jobs preserved/ });
  await fixedCard.click();
  await expect(page.getByRole("heading", { name: "Fixed jobs preserved" })).toBeVisible();
  await expect(page.getByText(/immovable/i)).toBeVisible();
  await expect(fixedCard).toHaveAttribute("aria-expanded", "true");
  if (testInfo.project.name !== "mobile-chromium") {
    const analyticsPanel = page.locator(".map-floating-analytics");
    const analyticsBefore = await analyticsPanel.boundingBox();
    const analyticsHandle = await page.getByRole("button", { name: "Move analytics panel" }).boundingBox();
    await page.mouse.move(analyticsHandle!.x + analyticsHandle!.width / 2, analyticsHandle!.y + analyticsHandle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(analyticsHandle!.x + analyticsHandle!.width / 2 + 55, analyticsHandle!.y + analyticsHandle!.height / 2 + 25, { steps: 5 });
    await page.mouse.up();
    const analyticsAfter = await analyticsPanel.boundingBox();
    expect(analyticsAfter!.x).toBeGreaterThan(analyticsBefore!.x + 20);
  }
  await page.getByRole("button", { name: "Collapse analytics" }).click();
  await expect(page.locator(".map-floating-analytics")).toHaveClass(/collapsed/);
  await expect(page.getByText(/immovable/i)).toHaveCount(0);
  await expect(fixedCard).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Expand analytics" }).click();
  await expect(page.getByText(/immovable/i)).toBeVisible();
  await expect(fixedCard).toHaveAttribute("aria-expanded", "true");
  await fixedCard.click();
  await expect(page.getByRole("heading", { name: "Fixed jobs preserved" })).toHaveCount(0);
  await expect(page.getByText("One day, before and after")).toHaveCount(0);

  const conditions = page.getByLabel("Hourly environmental conditions");
  const conditionsBefore = await conditions.boundingBox();
  const conditionsHandle = await page.getByRole("button", { name: "Move hourly conditions panel" }).boundingBox();
  expect(conditionsBefore).not.toBeNull();
  expect(conditionsHandle).not.toBeNull();
  await page.mouse.move(conditionsHandle!.x + conditionsHandle!.width / 2, conditionsHandle!.y + conditionsHandle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(conditionsHandle!.x + conditionsHandle!.width / 2, conditionsHandle!.y + conditionsHandle!.height / 2 + 45, { steps: 5 });
  await page.mouse.up();
  const conditionsAfter = await conditions.boundingBox();
  expect(conditionsAfter!.y).toBeGreaterThan(conditionsBefore!.y + 20);

  const legend = page.locator(".map-legend");
  const legendBefore = await legend.boundingBox();
  const legendHandle = await page.getByRole("button", { name: "Move heatmap legend" }).boundingBox();
  await page.mouse.move(legendHandle!.x + legendHandle!.width / 2, legendHandle!.y + legendHandle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(legendHandle!.x + legendHandle!.width / 2 + 45, legendHandle!.y + legendHandle!.height / 2 - 35, { steps: 5 });
  await page.mouse.up();
  const legendAfter = await legend.boundingBox();
  expect(legendAfter!.x).toBeGreaterThan(legendBefore!.x + 20);

  await expect(page.getByLabel("AI operational briefing")).toBeVisible();
  await expect(page.getByLabel("HeatShift analytics")).toBeVisible();
});

test("guide and operation story explain the full daily calculation without leaving the console", async ({ page }) => {
  await openConsole(page);
  await page.getByRole("button", { name: /Guide/ }).click();
  const guide = page.getByRole("dialog", { name: "HeatShift console guide" });
  await expect(guide.getByRole("heading", { name: "From a location to a reviewed plan." })).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Choose the site" })).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Generate the day" })).toBeVisible();
  await expect(guide.getByRole("heading", { name: "Run HeatShift" })).toBeVisible();
  await expect(guide.getByText("Built-in sites use cached FortyGuard evidence. New-site weather and all generated operations are clearly labeled.")).toBeVisible();
  await guide.getByRole("button", { name: "Start exploring" }).click();

  await page.getByRole("tab", { name: /DesertLine Logistics Yard.*Analysis ready/ }).click();
  await page.getByRole("button", { name: /Operation & method/ }).click();
  const story = page.getByRole("dialog", { name: /DesertLine Logistics Yard operation and methodology/ });
  await expect(story.getByRole("heading", { name: "See the operation HeatShift received, what changed, and why." })).toBeVisible();
  await expect(story.getByText("Job-level comparison")).toBeVisible();
  await expect(story.getByRole("heading", { name: "Weather describes this day. Climate describes a pattern across years." })).toBeVisible();
  await expect(story.getByRole("heading", { name: "Heat, people and disruption stay visible as separate decisions." })).toBeVisible();
  await expect(story.getByRole("heading", { name: "A constrained search, not an AI guess." })).toBeVisible();
  await expect(story.getByText("Every job exactly once")).toBeVisible();
  const readability = await story.evaluate((root) => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
    const body = [...root.querySelectorAll("p")].filter(visible).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter((size) => size < 14);
    const supporting = [...root.querySelectorAll("small")].filter(visible).map((element) => Number.parseFloat(getComputedStyle(element).fontSize)).filter((size) => size < 12);
    const controls = [...root.querySelectorAll("button")].filter(visible).map((element) => element.getBoundingClientRect().height).filter((height) => height < 44);
    return { body, supporting, controls };
  });
  expect(readability).toEqual({ body: [], supporting: [], controls: [] });
  await story.getByRole("button", { name: /Back to map/ }).click();
  await expect(story).toHaveCount(0);
});

test("provider outage stays in the header and a successful retry exits fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "fallback journey runs once");
  await page.unroute("**/api/daily/provider-status*");
  await page.route("**/api/daily/provider-status*", async (route) => {
    const available = route.request().url().includes("refresh=true");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(available
      ? { state: "available", live_available: true, fallback_active: false, credits_remaining: 500000, checked_at: "2026-09-18T00:01:00Z", message: "FortyGuard responded." }
      : { state: "provider_unavailable", live_available: false, fallback_active: true, credits_remaining: null, checked_at: "2026-09-18T00:00:00Z", message: "A secure connection to FortyGuard could not be established. Cached and simulated evidence remain available." }) });
  });
  await openConsole(page);
  const provider = page.getByRole("status");
  await expect(provider.getByText("Simulated run", { exact: true })).toBeVisible();
  await expect(provider).toContainText("FortyGuard could not be reached securely");
  await expect(page.getByRole("dialog", { name: "FortyGuard fallback active" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /DesertLine Logistics Yard.*Analysis ready/ })).toBeVisible();
  await provider.getByRole("button", { name: "Retry" }).click();
  await expect(provider.getByText("FortyGuard live", { exact: true })).toBeVisible();
  await expect(provider).toContainText("The data provider responded successfully.");
  await expect(provider.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("a new location follows create, generate and analyze entirely on the map", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "chromium", "mutation journey runs once");
  await openConsole(page);
  await page.getByRole("tab", { name: /DesertLine Logistics Yard.*Analysis ready/ }).click();
  await expect(page.locator(".map-floating-panel-layer")).toBeVisible();
  await page.getByRole("button", { name: "+ Create site" }).click();
  const dialog = page.getByRole("dialog", { name: "Create daily operation site" });
  await expect(dialog).toHaveClass(/create-site-backdrop/);
  await expect(dialog.getByLabel("Site name")).toBeFocused();
  const layering = await page.evaluate(() => ({
    modal: Number.parseInt(getComputedStyle(document.querySelector(".create-site-backdrop")!).zIndex, 10),
    tabs: Number.parseInt(getComputedStyle(document.querySelector(".map-site-tabs")!).zIndex, 10),
    floating: Number.parseInt(getComputedStyle(document.querySelector(".map-floating-panel-layer")!).zIndex, 10),
  }));
  expect(layering.modal).toBeGreaterThan(layering.tabs);
  expect(layering.modal).toBeGreaterThan(layering.floating);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.locator(".leaflet-container").dblclick({ position: { x: 350, y: 470 } });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/create-site-backdrop/);
  await expect(dialog.getByLabel("Site name")).toBeFocused();
  await dialog.getByLabel("Site name").fill("E2E Field Operation");
  await dialog.getByLabel("Operation type").fill("utility maintenance");
  await dialog.getByLabel("Longitude").fill("-112.05");
  await dialog.getByLabel("Latitude").fill("33.45");
  await dialog.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(page.getByRole("tab", { name: /E2E Field Operation.*Analysis not ready/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Generate this operation")).toBeVisible();

  await page.getByRole("button", { name: /Operation & method/ }).click();
  const method = page.getByRole("dialog", { name: /E2E Field Operation operation and methodology/ });
  await expect(method.getByText("Generate the fictional operation")).toBeVisible();
  await method.getByLabel("Method random seed").fill("90210");
  await method.getByLabel("Method crews").selectOption("6");
  await method.getByLabel("Method jobs per crew").selectOption("3");
  const generated = page.waitForResponse((response) => response.url().includes("/simulation") && response.request().method() === "POST");
  await method.getByRole("button", { name: /Generate operation/ }).click();
  await generated;
  await expect(method.getByText("52 workers across 6 crews")).toBeVisible({ timeout: 30_000 });
  await expect(method.getByText(/18 jobs · \d+ fixed · \d+ movable/)).toBeVisible();

  const analyzed = page.waitForResponse((response) => response.url().endsWith("/analysis") && response.request().method() === "POST");
  await method.getByRole("button", { name: /Run HeatShift analysis/ }).click();
  await analyzed;
  await expect(method.getByText("Analysis ready")).toBeVisible({ timeout: 30_000 });
  await expect(method.getByText(/high-risk worker-time avoided/i)).toBeVisible();
  await method.getByRole("button", { name: /Back to map/ }).click();
  await expect(page.getByRole("heading", { name: "Operational briefing" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Hard violations 0/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Collapse AI briefing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand analytics" })).toBeVisible();
  await expect(page.locator("[data-cell-id]").first()).toBeVisible();

  await page.getByRole("button", { name: /Reset defaults/ }).click();
  const reset = page.getByRole("dialog", { name: "Reset HeatShift workspace" });
  await expect(reset.getByRole("heading", { name: "Reset this workspace?" })).toBeVisible();
  const resetResponse = page.waitForResponse((response) => response.url().endsWith("/api/daily/reset") && response.request().method() === "POST");
  await reset.getByRole("button", { name: "Reset everything" }).click();
  await resetResponse;
  await expect(page.getByRole("tab", { name: /E2E Field Operation/ })).toHaveCount(0);
  await expect(page.getByText("Arizona operations")).toBeVisible();
});

test("the interactive map does not depend on WebGL", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "rendering-path regression runs once");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openPhoenix(page);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator("[data-cell-id]").first()).toBeVisible();
  await expect(page.getByText("Map unavailable")).toHaveCount(0);
});

test("map console typography and primary controls remain readable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "computed-style regression runs once");
  await openPhoenix(page);
  const violations = await page.evaluate(() => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
    const text = [...document.querySelectorAll(".map-console-shell p, .map-console-shell label, .map-console-shell input, .map-console-shell select")].filter(visible).map((element) => ({ size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.size < 14 && !item.text?.match(/^(00|23)$/));
    const targets = [...document.querySelectorAll(".map-mobile-panel-toggle, .map-console-sidebar button, .map-console-sidebar select, .map-console-sidebar input, .map-site-tabs button")].filter(visible).map((element) => ({ height: element.getBoundingClientRect().height, text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.height < 44);
    return { text, targets };
  });
  expect(violations).toEqual({ text: [], targets: [] });
});

test("mobile view keeps the map primary and exposes setup on demand", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile-only journey");
  await openConsole(page);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.getByRole("button", { name: "Setup & sites" }).click();
  await expect(page.getByText("Start on the map")).toBeVisible();
  await page.locator(".map-console-sidebar .site-list-card").filter({ hasText: "DesertLine Logistics Yard" }).click();
  await page.getByRole("button", { name: "Setup & sites" }).click();
  await expect(page.getByText("Three-step flow")).toHaveCount(0);
  await expect(page.getByText("Real conditions and fictional work stay separate.")).toHaveCount(0);
  await page.getByRole("button", { name: "Close setup panel" }).click();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});
