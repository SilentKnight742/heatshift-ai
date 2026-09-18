import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
});

async function openConsole(page: Page) {
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "DesertLine Logistics Yard", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("HeatShift proposal")).toBeVisible();
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

test("three pre-analyzed examples expose daily weather, metrics and schedules", async ({ page }) => {
  await openConsole(page);
  await expect(page.getByText("Analyzed examples")).toBeVisible();
  for (const code of ["AZ", "TX", "FL"]) await expect(page.getByRole("button", { name: code, exact: true })).toBeVisible();
  await expect(page.getByText("Real cached FortyGuard day")).toBeVisible();
  await expect(page.getByText("Workers", { exact: true })).toBeVisible();
  await expect(page.getByText("Total jobs", { exact: true })).toBeVisible();
  await expect(page.getByText("Exposure reduction", { exact: true })).toBeVisible();
  await expect(page.getByText("High-risk time avoided", { exact: true })).toBeVisible();
  await expect(page.getByText("Crew Exposure Load", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "HeatShift" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Original" }).click();
  await expect(page.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Simulated local hour").fill("12");
  await expect(page.getByText("12:00", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "TX", exact: true }).click();
  await expect(page.getByRole("heading", { name: "GulfGate Container Terminal", level: 1 })).toBeVisible();
});

test("a new location follows create, generate, analyze without weekly controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "mutation journey runs once");
  await openConsole(page);
  await expect(page.getByText(/week starts/i)).toHaveCount(0);
  await page.getByRole("button", { name: "+ Create site" }).click();
  const dialog = page.getByRole("dialog", { name: "Create daily operation site" });
  await dialog.getByLabel("Site name").fill("E2E Field Operation");
  await dialog.getByLabel("Operation type").fill("utility maintenance");
  await dialog.getByLabel("Longitude").fill("-112.05");
  await dialog.getByLabel("Latitude").fill("33.45");
  await dialog.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E Field Operation", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Generate the operation" })).toBeVisible();

  await page.getByLabel("Random seed").fill("90210");
  await page.getByLabel("Crews").selectOption("6");
  await page.getByLabel("Jobs per crew").selectOption("3");
  const generated = page.waitForResponse((response) => response.url().includes("/simulation") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate simulation", exact: true }).click();
  await generated;
  await expect(page.getByText("18", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Locally simulated hourly weather/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Baseline generated. Run the analysis." })).toBeVisible();

  const analyzed = page.waitForResponse((response) => response.url().endsWith("/analysis") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run HeatShift analysis", exact: true }).first().click();
  await analyzed;
  await expect(page.getByText("HeatShift proposal")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Hard violations")).toBeVisible();
  await expect(page.locator(".daily-result-strip").getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "One day, before and after" })).toBeVisible();
});

test("forced WebGL failure uses the interactive SVG thermal field", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "forced rendering path runs once");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openConsole(page);
  await expect(page.getByRole("img", { name: /DesertLine Logistics Yard thermal field fallback/ })).toBeVisible();
  await expect(page.locator(".weekly-map-canvas canvas")).toHaveCount(0);
});

test("daily console typography and primary touch targets remain readable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "computed-style regression runs once");
  await openConsole(page);
  const violations = await page.evaluate(() => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
    const text = [...document.querySelectorAll(".daily-shell p, .daily-shell label, .daily-shell input, .daily-shell select")].filter(visible).map((element) => ({ size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.size < 14);
    const support = [...document.querySelectorAll(".daily-shell small, .daily-shell .eyebrow")].filter(visible).map((element) => ({ size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.size < 12);
    const targets = [...document.querySelectorAll(".daily-toolbar button, .daily-sidebar button, .daily-sidebar select, .daily-sidebar input")].filter(visible).map((element) => ({ height: element.getBoundingClientRect().height, text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.height < 44);
    return { text, support, targets };
  });
  expect(violations).toEqual({ text: [], support: [], targets: [] });
});

test("mobile view keeps the full three-stage flow readable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile-only journey");
  await openConsole(page);
  await expect(page.getByText("Product flow")).toBeVisible();
  await expect(page.getByText("Generate simulation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Run analysis", { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});
