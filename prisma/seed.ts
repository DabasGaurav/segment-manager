import { PrismaClient } from "@prisma/client";
import { seedDemo } from "../src/lib/db/seed";

const prisma = new PrismaClient();
seedDemo(prisma, { bidderKey: process.env.BIDDER_SERVICE_KEY ?? "", readonlyKey: process.env.DEMO_READONLY_KEY ?? "" })
  .then(() => console.log("Seeded synthetic demo tenant."))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
