import { expect, test } from "@playwright/test";

test("status page shows verified official taxonomy files", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Segment Manager" })).toBeVisible();
  await expect(page.getByText("IAB Content Taxonomy 3.0")).toBeVisible();
  await expect(page.getByText("IAB Audience Taxonomy 1.1")).toBeVisible();
});

test("signed-out visitors cannot run checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Check signals" })).toBeDisabled();
});

test("persona sign-in, taxonomy lookup and detection", async ({ page }) => {
  await page.goto("/");
  await Promise.all([page.waitForEvent("load"), page.getByLabel("Signed in as").selectOption("admin")]);
  await expect(page.getByLabel("Signed in as")).toHaveValue("admin");
  await expect(page.getByRole("button", { name: "Look up" })).toBeEnabled();

  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.locator("pre")).toContainText('"name": "Green Vehicles"');

  await page.getByRole("button", { name: "Check signals" }).click();
  await expect(page.getByText("2 segments in 1 Data objects: 1 valid IAB")).toBeVisible();
  await expect(page.getByRole("cell", { name: "SEGTAX_ID_NOT_IN_TAXONOMY" })).toBeVisible();

  await page.getByLabel("Sample request").selectOption("drivedesk-proprietary");
  await page.getByRole("button", { name: "Check signals" }).click();
  await expect(page.getByText("4 proprietary")).toBeVisible();

  await page.getByLabel("Request body").fill('{"publisher_id":"pub_drivedesk","dsp":"ttd","bid_request":{"imp":[]}}');
  await page.getByRole("button", { name: "Check signals" }).click();
  await expect(page.getByText(/400 SCHEMA_VIOLATION/)).toBeVisible();
});
