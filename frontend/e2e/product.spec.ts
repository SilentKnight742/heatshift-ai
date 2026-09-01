import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
});

async function openConsole(page: Page) {
  await page.goto("/console");
  await expect(page.getByRole("heading", { name: "DesertLine Logistics Yard", level: 1 })).toBeVisible({ timeout: 30_000 });
  const walkthrough = page.getByRole("dialog", { name: "HeatShift walkthrough" });
  await expect(walkthrough).toBeVisible();
  await walkthrough.getByRole("button", { name: "Skip" }).click();
  await expect(walkthrough).toBeHidden();
  await expect(page.getByText("Recommended plan")).toBeVisible();
}

test("homepage explains the generic weekly product, metrics, evidence and limits", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "full copy journey runs once");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Plan the week.*Respect the heat/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Site Thermal Burden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crew Exposure Load" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational Disruption" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /higher HeatShift scores correspond/ })).toBeVisible();
  await expect(page.getByLabel("HEAT-SHIELD dataset summary").getByText("566", { exact: true })).toBeVisible();
  await expect(page.getByText(/does not.*mean 78% fewer injuries/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Three data layers, clearly separated." })).toBeVisible();
  await page.getByRole("link", { name: /Open the HeatShift console/ }).click();
  await expect(page).toHaveURL(/\/console$/);
});

test("weekly console navigates state, day, hour, plan layers and deterministic metrics", async ({ page }) => {
  await openConsole(page);
  await expect(page.getByRole("tab", { name: "Portfolio", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tablist", { name: "Week days" }).getByRole("tab")).toHaveCount(7);
  await page.getByRole("tab", { name: "Site", exact: true }).click();
  await page.getByRole("tablist", { name: "Week days" }).getByRole("tab").nth(1).click();
  await page.getByLabel("Simulated local hour").evaluate((element) => {
    const input = element as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, "12");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByText("12:00", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Site Thermal Burden/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Crew Exposure Load/ })).toBeVisible();
  await page.getByRole("tab", { name: "Original", exact: true }).click();
  await page.getByRole("tab", { name: "HeatShift", exact: true }).click();
  await page.getByRole("tab", { name: "Working", exact: true }).click();
  await expect(page.getByText("Constraint-valid proposal")).toBeVisible();
});

test("metric inspection and grounded Q&A show formulas before model prose", async ({ page }, testInfo) => {
  test.skip(!["chromium", "firefox", "webkit"].includes(testInfo.project.name), "desktop inspector journey");
  await openConsole(page);
  await page.getByRole("button", { name: /Site Thermal Burden/ }).click();
  const drawer = page.getByRole("complementary", { name: "Result details" });
  await expect(drawer.getByText(/Σ max\(0, hourly apparent temperature/)).toBeVisible();
  await expect(drawer.getByText(/35°C is a configurable product threshold/)).toBeVisible();
  await drawer.getByLabel("Ask AI about this result").fill("Why does this matter for the week?");
  await drawer.getByRole("button", { name: "Ask grounded AI" }).click();
  await expect(drawer.locator(".drawer-answer")).toBeVisible({ timeout: 30_000 });
  await expect(drawer.getByText(/Session Q&A history · 1/)).toBeVisible();
});

test("private site, crew and job CRUD works before environmental acquisition", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "mutation journey runs once");
  await openConsole(page);
  await page.getByRole("button", { name: "+ Create site" }).click();
  const dialog = page.getByRole("dialog", { name: "Create site" });
  await dialog.getByLabel("Site name").fill("E2E Maintenance Yard");
  await dialog.getByLabel("Longitude").fill("-112.05");
  await dialog.getByLabel("Latitude").fill("33.45");
  await dialog.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(page.getByRole("heading", { name: "E2E Maintenance Yard", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fetch this exact site and week" })).toBeVisible();
  await page.getByRole("tab", { name: /crews0/i }).click();
  await page.getByRole("button", { name: "+ Add crew" }).click();
  await expect(page.getByRole("tab", { name: /crews1/i })).toBeVisible();
  await page.getByRole("tab", { name: /jobs0/i }).click();
  await page.getByRole("button", { name: "+ Add job" }).click();
  await expect(page.getByRole("tab", { name: /jobs1/i })).toBeVisible();
  await expect(page.getByText("New job 1", { exact: true })).toBeVisible();
});

test("working-plan edits reject invalid drops and job lifecycle changes recompute the week", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "mutation and constraint journey runs once");
  await openConsole(page);
  await page.getByRole("tab", { name: "Site", exact: true }).click();

  const movable = page.locator(".timeline-job").filter({ hasText: "Equipment inspection" });
  await expect(movable).toBeVisible();
  await page.evaluate(() => {
    const source = [...document.querySelectorAll<HTMLElement>(".timeline-job")].find((element) => element.textContent?.includes("Equipment inspection"));
    const target = document.querySelectorAll<HTMLElement>(".timeline-drop-grid > div")[23];
    if (!source || !target) throw new Error("timeline drag fixtures were not rendered");
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  });
  const planError = page.locator(".weekly-error[role=alert]");
  await expect(planError).toContainText("outside its allowed date/time window");
  await planError.getByRole("button", { name: "Dismiss" }).click();

  const applyResponse = page.waitForResponse((response) => response.url().includes("/plans/working") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Apply full HeatShift plan" }).click();
  await applyResponse;
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeEnabled();
  const undoResponse = page.waitForResponse((response) => response.url().includes("/plans/working") && response.request().method() === "PATCH");
  await undo.click();
  await undoResponse;
  await expect(undo).toBeDisabled();
  const resetResponse = page.waitForResponse((response) => response.url().includes("/plans/working") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Reset working" }).click();
  await resetResponse;
  await expect(undo).toBeEnabled();

  await page.getByRole("tab", { name: /jobs6/i }).click();
  const inventory = page.locator(".operation-card").filter({ hasText: "Inventory and closeout" });
  await inventory.getByRole("combobox", { name: /Inventory and closeout status/ }).selectOption("cancelled");
  await expect(inventory.getByRole("combobox", { name: /Inventory and closeout status/ })).toHaveValue("cancelled");
  await expect(page.getByText(/84% work retained/)).toBeVisible();

  const perimeterStatus = page.getByRole("combobox", { name: /Perimeter inspection status/ });
  const perimeter = perimeterStatus.locator("xpath=ancestor::article");
  await perimeter.getByRole("button", { name: "Next day" }).click();
  await expect(perimeterStatus).toHaveValue("deferred");
  await page.getByRole("tablist", { name: "Week days" }).getByRole("tab").nth(6).click();
  await expect(page.getByLabel("Jobs by current operational status").getByText("Perimeter inspection")).toBeVisible();
});

test("forced WebGL failure uses the interactive SVG/GeoJSON fallback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "forced rendering path runs once");
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2") return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await openConsole(page);
  await expect(page.getByRole("img", { name: /AZ site portfolio map fallback/ })).toBeVisible();
  await page.getByRole("button", { name: /DesertLine Logistics Yard/ }).first().click();
  await expect(page.getByRole("img", { name: /DesertLine Logistics Yard thermal field fallback/ })).toBeVisible();
  await expect(page.locator(".weekly-map-canvas canvas")).toHaveCount(0);
});

test("console typography and touch targets meet the product minimums", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "computed-style regression runs once");
  await openConsole(page);
  const violations = await page.evaluate(() => {
    const visible = (element: Element) => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"; };
    const text = [...document.querySelectorAll(".weekly-shell p, .weekly-shell label, .weekly-shell input, .weekly-shell select, .weekly-shell textarea")].filter(visible).map((element) => ({ element: element.tagName, size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.size < 14);
    const support = [...document.querySelectorAll(".weekly-shell small, .weekly-shell .eyebrow")].filter(visible).map((element) => ({ element: element.tagName, size: Number.parseFloat(getComputedStyle(element).fontSize), text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.size < 12);
    const targets = [...document.querySelectorAll(".weekly-toolbar button, .weekly-sidebar button, .weekly-sidebar select")].filter(visible).map((element) => ({ element: element.tagName, height: element.getBoundingClientRect().height, text: element.textContent?.trim().slice(0, 40) })).filter((item) => item.height < 44);
    return { text, support, targets };
  });
  expect(violations).toEqual({ text: [], support: [], targets: [] });
});

test("walkthrough can complete and restart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "walkthrough journey runs once");
  await page.goto("/console");
  const walkthrough = page.getByRole("dialog", { name: "HeatShift walkthrough" });
  await expect(walkthrough).toBeVisible({ timeout: 30_000 });
  for (let index = 0; index < 4; index += 1) await walkthrough.getByRole("button", { name: "Next" }).click();
  await walkthrough.getByRole("button", { name: "Open the console" }).click();
  await expect(walkthrough).toBeHidden();
  await page.getByRole("button", { name: "Walkthrough" }).click();
  await expect(walkthrough).toBeVisible();
});

test("mobile console is readable, collapses setup and avoids page overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile-only journey");
  await openConsole(page);
  const manage = page.getByRole("button", { name: "Manage" });
  await expect(manage).toHaveAttribute("aria-expanded", "false");
  await manage.click();
  await expect(manage).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Manage the week" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});
