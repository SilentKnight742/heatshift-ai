import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("homepage explains the decision, evidence boundaries, and research in plain language", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Move the work.*Keep the shift/ })).toBeVisible();
  await expect(page.getByText("Heavy cargo loading", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("1,230", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/does not mean 78% fewer injuries/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /AI explains the decision/ })).toBeVisible();
  await expect(page.getByText(/model can explain them, but it cannot replace them/i)).toBeVisible();
  const researchSummary = page.getByLabel("HEAT-SHIELD dataset summary");
  await expect(researchSummary.getByText("566", { exact: true })).toBeVisible();
  await expect(researchSummary.getByText("measured exposure sessions", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Two evidence layers/ })).toBeVisible();
  await expect(page.getByText(/12 fictional workers/i)).toHaveCount(0);
  await page.getByRole("link", { name: /Open the HeatShift console/ }).click();
  await expect(page).toHaveURL(/\/console$/);
});

test("mobile homepage remains readable without document-level horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile viewport check");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Move the work.*Keep the shift/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});

test("default console renders complete evidence, SVG map, and agent brief", async ({ page }) => {
  await page.goto("/console");
  await expect(page.getByText("Analysis complete")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("78.0%", { exact: true })).toBeVisible();
  await expect(page.getByText("1,230 → 270")).toBeVisible();
  await expect(page.getByRole("img", { name: /FortyGuard temperature grid/ })).toBeVisible();
  await expect(page.locator(".map-canvas canvas")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What the AI recommends" })).toBeVisible();
  await expect(page.getByText(/only explains the validated result/)).toBeVisible();
});

test("editing invalidates stale output, persists locally, and reruns", async ({ page }) => {
  await page.goto("/console");
  await expect(page.getByText("Analysis complete")).toBeVisible({ timeout: 30_000 });
  const site = page.getByLabel("Worksite name");
  await site.fill("Hard Scenario Yard");
  await expect(page.getByText(/Build a scenario, then run the analysis/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("heatshift-scenario-v1")!).site.name)).toBe("Hard Scenario Yard");
  await page.getByRole("button", { name: /Run analysis/ }).click();
  await expect(page.getByText("Analysis complete")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Hard Scenario Yard", level: 1 })).toBeVisible();
});

test("new scenario CRUD controls create collections and reset reference data", async ({ page }) => {
  await page.goto("/console");
  await expect(page.getByText("Analysis complete")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "New" }).click();
  await expect(page.locator('input[value="Untitled fictional operation"]')).toBeVisible();
  await page.getByRole("tab", { name: /Crews/ }).click();
  await page.getByRole("button", { name: "+ Add crew" }).click();
  await expect(page.getByRole("tab", { name: /Crews 2/ })).toBeVisible();
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page.getByRole("button", { name: "+ Add task" }).click();
  await expect(page.getByRole("tab", { name: /Tasks 2/ })).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("tab", { name: /Crews 3/ })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("heatshift-scenario-v1"))).toBeNull();
});

test("mobile console has no document-level horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "mobile viewport check");
  await page.goto("/console");
  await expect(page.getByText("Analysis complete")).toBeVisible({ timeout: 30_000 });
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});
