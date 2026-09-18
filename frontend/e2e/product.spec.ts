import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
});

async function openConsole(page: Page) {
  await page.goto("/console");
  await expect(page.getByRole("tab", { name: /All sites/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Arizona operations")).toBeVisible();
}

async function openPhoenix(page: Page) {
  await openConsole(page);
  await page.getByRole("tab", { name: "DesertLine Logistics Yard" }).click();
  await expect(page.getByLabel("Hourly environmental conditions")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Exposure reduction/ })).toBeVisible();
}

test("homepage explains the daily product, metrics, evidence and limits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "full copy journey runs once");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Plan the day.*Respect the heat/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Site Thermal Burden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crew Exposure Load" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational Disruption" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /higher HeatShift scores correspond/ })).toBeVisible();
  await expect(page.getByText(/does not.*mean 78% fewer injuries/i)).toBeVisible();
  await expect(page.getByText("A one-day, site-level operations simulator")).toBeVisible();
  await page.getByRole("link", { name: /Open the HeatShift console/ }).click();
  await expect(page).toHaveURL(/\/console$/);
});

test("one persistent map supports state sites, auto-zoom, hourly cells and contextual results", async ({ page }) => {
  await openConsole(page);
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByRole("tab", { name: "DesertLine Logistics Yard" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Portfolio" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Site", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "DesertLine Logistics Yard" }).click();
  await expect(page.getByText("Cached FortyGuard evidence", { exact: true })).toBeVisible();
  await expect(page.locator("[data-cell-id]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "HeatShift" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Selected local hour").fill("12");
  await expect(page.getByText("12:00", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Original" }).click();
  await expect(page.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");

  const populatedCell = page.locator('[data-cell-id]:not([aria-label*=" 0 jobs,"])').first();
  await expect(populatedCell).toBeVisible();
  await populatedCell.click();
  await expect(page.getByText("Selected 100 m cell")).toBeVisible();
  await expect(page.getByText("Operations in this cell")).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();

  await page.getByRole("button", { name: /Exposure reduction/ }).click();
  await expect(page.getByRole("heading", { name: "Exposure reduction" })).toBeVisible();
  await expect(page.getByText(/threshold-dependent/i)).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: /Fixed jobs preserved/ }).click();
  await expect(page.getByRole("heading", { name: "Fixed jobs preserved" })).toBeVisible();
  await expect(page.getByText(/immovable/i)).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(page.getByText("One day, before and after")).toHaveCount(0);
});

test("a new location follows create, generate and analyze entirely on the map", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "mutation journey runs once");
  await openConsole(page);
  await page.getByRole("button", { name: "+ Create site" }).click();
  const dialog = page.getByRole("dialog", { name: "Create daily operation site" });
  await dialog.getByLabel("Site name").fill("E2E Field Operation");
  await dialog.getByLabel("Operation type").fill("utility maintenance");
  await dialog.getByLabel("Longitude").fill("-112.05");
  await dialog.getByLabel("Latitude").fill("33.45");
  await dialog.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(page.getByRole("tab", { name: "E2E Field Operation" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Generate this operation")).toBeVisible();

  await page.getByLabel("Random seed").fill("90210");
  await page.getByLabel("Crews").selectOption("6");
  await page.getByLabel("Jobs per crew").selectOption("3");
  const generated = page.waitForResponse((response) => response.url().includes("/simulation") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate simulation", exact: true }).click();
  await generated;
  await expect(page.locator(".daily-simulation-controls p").filter({ hasText: "52 workers · 18 jobs" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Locally simulated weather")).toBeVisible();
  await expect(page.getByText("Baseline ready")).toBeVisible();

  const analyzed = page.waitForResponse((response) => response.url().endsWith("/analysis") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run HeatShift analysis", exact: true }).first().click();
  await analyzed;
  await expect(page.getByRole("button", { name: /Hard violations 0/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /AI briefing Read/ })).toBeVisible();
  await expect(page.locator("[data-cell-id]").first()).toBeVisible();
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
    const targets = [...document.querySelectorAll(".map-console-toolbar button, .map-console-sidebar button, .map-console-sidebar select, .map-console-sidebar input, .map-site-tabs button")].filter(visible).map((element) => ({ height: element.getBoundingClientRect().height, text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.height < 44);
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
  await expect(page.getByText("Three-step flow")).toBeVisible();
  await page.getByRole("button", { name: "Close setup panel" }).click();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});
