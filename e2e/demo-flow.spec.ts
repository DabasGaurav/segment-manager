import { expect, test } from "@playwright/test";

test("guided demo: import, review, permissions, publish, resolve, rollback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("Reset demo: done")).toBeVisible();
  await page.getByRole("button", { name: /Import dictionary/ }).click();
  await expect(page.getByText(/1 approved, 4 waiting for review/)).toBeVisible();

  const row = (raw: string) => page.locator("tr", { has: page.locator(`code:text-is("${raw}")`) });
  await row("hlth_diab").getByRole("button", { name: "Try to approve" }).click();
  await expect(page.getByText(/SENSITIVE_OVERRIDE_FORBIDDEN/).first()).toBeVisible();
  await row("ev-news").getByRole("button", { name: "Approve" }).click();
  await expect(row("ev-news").getByText("APPROVED", { exact: true })).toBeVisible();
  await row("ev_research").getByRole("button", { name: "Approve" }).click();
  await expect(row("ev_research").getByText("APPROVED", { exact: true })).toBeVisible();
  await row("ev_intent").getByRole("button", { name: /Reclassify/ }).click();
  await expect(row("ev_intent").getByText("APPROVED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Save \(as publisher ops\)/ }).click();
  await expect(page.getByText("Save permissions: done")).toBeVisible();
  await page.getByRole("button", { name: /Publish approved mappings/ }).click();
  await expect(page.getByText("Publish new version: done")).toBeVisible();
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("active", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("ID out")).toBeVisible();
  await expect(page.getByRole("cell", { name: "7/22 Green Vehicles", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/demo-flow.png", fullPage: true });

  await page.getByLabel("Reader").selectOption("eu-no-profiles");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByText("PURPOSE_CONSENT_MISSING").first()).toBeVisible();
  await expect(page.getByText("version.activated")).toBeVisible();
});
