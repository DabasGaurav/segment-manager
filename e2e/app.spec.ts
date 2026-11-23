import { test, expect, type Page } from "@playwright/test";

// Drives the real UI against the real API. Every outcome asserted here comes from the server.
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.E2E_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function signIn(page: Page, persona: string) {
  const r = await page.request.post("/v1/demo/sessions", { data: { persona }, ...H() });
  expect(r.ok()).toBeTruthy();
}

/** Sign in, then load the page fresh so the app picks up the session. */
async function openAs(page: Page, persona: string, hash = "") {
  // Sign in before the first page load: a signed-out first visit auto-signs in as DriveDesk ops.
  await signIn(page, persona);
  await page.goto("/" + hash);
}

const origin = () => process.env.E2E_BASE_URL ?? "http://localhost:3000";
const H = () => ({ headers: { Origin: origin() } });
const heading = (page: Page) => page.locator(".result-head h2");

test("overview explains the product and its three stages", async ({ page }) => {
  await openAs(page, "ops.drivedesk");
  await expect(page.getByRole("heading", { name: /usable by buyers, safely/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" }).getByText("Import & review")).toBeVisible();
  await expect(page.getByText("Synthetic").first()).toBeVisible();
  await shot(page, "01-overview");
});

test("guided demo runs end to end with real role changes", async ({ page }) => {
  // The guide's own "clean sample data" button performs the reset (rate limited to 6 a minute).
  await openAs(page, "ops.drivedesk");
  await page.getByRole("banner").getByRole("button", { name: "Start guided demo" }).click();
  const guide = page.getByRole("complementary", { name: "Guided demo" });
  await guide.getByRole("button", { name: "Start with clean sample data" }).click();
  await expect(page.getByText("Sample data reset")).toBeVisible();

  // 1. import as ops
  await guide.getByRole("button", { name: "Import the dictionary" }).click();
  await expect(page.getByText("Imported DriveDesk's dictionary.")).toBeVisible();
  await expect(page.locator(".signal").first()).toBeVisible();
  await shot(page, "02-review");

  // 2. review: the guide switches to the reviewer persona
  await guide.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByRole("combobox", { name: "Acting as" })).toHaveValue("reviewer.drivedesk");
  await expect(page.getByText("Approved EV news")).toBeVisible();
  await guide.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Approved EV researchers")).toBeVisible();
  // sensitive override is refused by the server
  await guide.getByRole("button", { name: "Try it" }).click();
  await expect(page.locator(".notice.bad")).toBeVisible();
  await shot(page, "02b-override-refused");
  await guide.getByRole("button", { name: "Reclassify as interest" }).click();
  await expect(page.getByText("EV intenders reclassified")).toBeVisible();

  // 3. grant as ops
  await guide.getByRole("button", { name: "Allow ttd, remove unmapped IDs" }).click();
  await expect(page.getByRole("combobox", { name: "Acting as" })).toHaveValue("ops.drivedesk");
  await expect(page.getByText("Permissions saved")).toBeVisible();

  // 4. publish as reviewer
  await guide.getByRole("button", { name: "Publish and make live" }).click();
  await expect(page.getByText("Published and made live.")).toBeVisible();
  await expect(page.getByText(/Version \d+ is live/).first()).toBeVisible();
  await shot(page, "03-publish");

  // 5. verify three scenarios on the real resolver
  await guide.getByRole("button", { name: "Show" }).first().click();
  await expect(heading(page)).toContainText("reach ttd");
  await expect(page.getByText("Green Vehicles").first()).toBeVisible();
  const consented = await heading(page).innerText();
  await shot(page, "04-verify-consented");
  await guide.getByRole("button", { name: "Show" }).first().click();
  await expect(heading(page)).not.toHaveText(consented);
  await shot(page, "05-verify-no-profiles");
  await guide.getByRole("button", { name: "Show" }).first().click();
  await expect(heading(page)).toContainText("xandr");
  await shot(page, "06-verify-xandr");

  await expect(guide.getByText("Done: DriveDesk's signals are live")).toBeVisible();
  await shot(page, "07-demo-done");
});

test("the diabetes segment never reaches the buyer", async ({ page }) => {
  await page.goto("/#verify");
  await expect(heading(page)).toBeVisible();
  const row = page.locator(".ba-row", { hasText: /Diabetes/i });
  await expect(row).toContainText("Not sent");
});

test("rollback needs confirmation and changes the live version", async ({ page }) => {
  await openAs(page, "reviewer.drivedesk", "#review");
  await page.locator(".filter", { hasText: "Approved" }).click();
  const evNews = page.locator(".signal", { hasText: "EV news" });
  await evNews.getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator(".notice.ok")).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByText("Configure & publish").click();
  await page.getByRole("button", { name: /Publish version 2/ }).click();
  await expect(page.getByText("Version 2 is live.")).toBeVisible();
  await page.getByRole("button", { name: "Roll back to this" }).click();
  await expect(page.getByText("Version 2 is live.")).toBeVisible(); // nothing changes until confirmed
  await shot(page, "08-rollback-confirm");
  await page.locator(".confirm").getByRole("button").first().click();
  await expect(page.getByText("Version 1 is live.")).toBeVisible();
});

test("a curator cannot see DriveDesk's workspace (server-enforced)", async ({ page }) => {
  await openAs(page, "curator.select", "#review");
  await expect(page.getByText("You can't view DriveDesk's workspace in this role")).toBeVisible();
  await shot(page, "09-denied");
  await page.getByRole("button", { name: "Switch to DriveDesk reviewer" }).click();
  await expect(page.locator(".signal").first()).toBeVisible();
});

test("ops cannot publish; the button names the role needed", async ({ page }) => {
  await openAs(page, "ops.drivedesk", "#publish");
  await expect(page.locator(".needs-role").first()).toContainText("Reviewer");
  const r = await page.request.post("/v1/publishers/pub_drivedesk/mapping-versions", { data: {}, ...H() });
  expect(r.status()).toBe(403);
});

test("developer view shows the API reference", async ({ page }) => {
  await page.goto("/#developer");
  await expect(page.getByRole("heading", { name: "API & technical details" })).toBeVisible();
  await expect(page.getByText("/v1/resolve").first()).toBeVisible();
  await shot(page, "10-developer");
});

test("signed-out visitors land on the overview", async ({ page }) => {
  await page.goto("/");
  await page.request.delete("/v1/demo/sessions", H());
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /usable by buyers, safely/ })).toBeVisible();
});

test("mobile layout has no horizontal scroll", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  for (const v of ["", "#review", "#publish", "#verify"]) {
    await page.goto("/" + v);
    await page.waitForTimeout(1000);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, v).toBeLessThanOrEqual(1);
    await shot(page, `11-mobile${v.replace("#", "-") || "-overview"}`);
  }
  await ctx.close();
});
