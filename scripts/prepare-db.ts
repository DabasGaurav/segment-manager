/**
 * Runs during `npm run build` (Vercel): applies migrations, then seeds the synthetic demo tenant
 * only if it does not exist yet. Re-deploys never wipe demo data; "Reset demo" does that on request.
 * If no database is configured (e.g. a local build), it skips with a warning.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { DEMO_TENANT, seedDemo } from "../src/lib/db/seed";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn("[prepare-db] DATABASE_URL not set: skipping migrations and seed.");
    return;
  }
  if (!process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.tenant.findUnique({ where: { id: DEMO_TENANT } });
    if (existing) {
      console.log("[prepare-db] Demo tenant present: leaving data as is.");
      return;
    }
    const bidderKey = process.env.BIDDER_SERVICE_KEY ?? "";
    const readonlyKey = process.env.DEMO_READONLY_KEY ?? "";
    if (bidderKey.length < 24 || readonlyKey.length < 24) {
      // Deploy still succeeds; the app runs without demo data until the keys are set and it is redeployed.
      console.warn("[prepare-db] BIDDER_SERVICE_KEY / DEMO_READONLY_KEY missing or shorter than 24 characters: demo tenant NOT seeded. Set them and redeploy.");
      return;
    }
    await seedDemo(prisma, { bidderKey, readonlyKey });
    console.log("[prepare-db] Seeded synthetic demo tenant.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[prepare-db] failed:", e);
  process.exit(1);
});
