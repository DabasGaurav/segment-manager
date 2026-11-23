/**
 * Seeds the synthetic demo tenant. All publishers, personas and keys here are SYNTHETIC.
 * Safe to re-run: it wipes and recreates the demo tenant only (used by "Reset demo" later).
 */
import type { PrismaClient } from "@prisma/client";
import { hashKey } from "@/lib/auth/keys";

export const DEMO_TENANT = "ten_demo";

export const DEMO_PUBLISHERS = [
  { id: "pub_drivedesk", displayName: "DriveDesk India (synthetic)", domain: "drivedesk.example", integration: "prebid" },
  { id: "pub_metrodaily", displayName: "Metro Daily (synthetic)", domain: "metrodaily.example", integration: "prebid_server" },
] as const;

export const DEMO_PERSONAS = [
  { id: "usr_ops_drivedesk", persona: "ops.drivedesk", displayName: "DriveDesk publisher ops", role: "publisher_ops", publishers: ["pub_drivedesk"] },
  { id: "usr_rev_drivedesk", persona: "reviewer.drivedesk", displayName: "DriveDesk reviewer", role: "reviewer", publishers: ["pub_drivedesk"] },
  { id: "usr_ops_metrodaily", persona: "ops.metrodaily", displayName: "Metro Daily publisher ops", role: "publisher_ops", publishers: ["pub_metrodaily"] },
  { id: "usr_rev_metrodaily", persona: "reviewer.metrodaily", displayName: "Metro Daily reviewer", role: "reviewer", publishers: ["pub_metrodaily"] },
  { id: "usr_curator", persona: "curator.select", displayName: "Deal curator", role: "curator", publishers: [] },
  { id: "usr_admin", persona: "admin", displayName: "Platform admin", role: "admin", publishers: [] },
] as const;

export async function seedDemo(prisma: PrismaClient, keys: { bidderKey: string; readonlyKey: string }) {
  if (keys.bidderKey.length < 24 || keys.readonlyKey.length < 24) {
    throw new Error("BIDDER_SERVICE_KEY and DEMO_READONLY_KEY must be at least 24 characters");
  }
  await prisma.$transaction(async (tx) => {
    // Audit events and mapping versions are append-only; the DB trigger allows deletes only
    // inside a transaction that sets this flag, which only the demo reset does.
    await tx.$executeRawUnsafe(`SET LOCAL app.allow_reset = 'on'`);
    await tx.auditEvent.deleteMany({ where: { tenantId: DEMO_TENANT } });
    const pubIds = DEMO_PUBLISHERS.map((p) => p.id);
    await tx.proposal.deleteMany({ where: { publisherId: { in: pubIds } } });
    await tx.dictionaryEntry.deleteMany({ where: { publisherId: { in: pubIds } } });
    await tx.import.deleteMany({ where: { publisherId: { in: pubIds } } });
    await tx.mappingVersion.deleteMany({ where: { publisherId: { in: pubIds } } });
    await tx.grant.deleteMany({ where: { publisherId: { in: pubIds } } });
    await tx.userPublisher.deleteMany({ where: { publisherId: { in: pubIds } } });
    await tx.user.deleteMany({ where: { tenantId: DEMO_TENANT } });
    await tx.serviceKey.deleteMany({ where: { tenantId: DEMO_TENANT } });
    await tx.publisher.deleteMany({ where: { tenantId: DEMO_TENANT } });
    await tx.tenant.deleteMany({ where: { id: DEMO_TENANT } });

    await tx.tenant.create({ data: { id: DEMO_TENANT, name: "Demo tenant (synthetic data)" } });
    for (const p of DEMO_PUBLISHERS) {
      await tx.publisher.create({ data: { ...p, tenantId: DEMO_TENANT, isSynthetic: true } });
      await tx.grant.create({ data: { publisherId: p.id, level: "G0", dspAllowlist: [], curatorAllowlist: [], unmappedHandling: "pass_raw" } });
    }
    for (const u of DEMO_PERSONAS) {
      await tx.user.create({
        data: {
          id: u.id,
          tenantId: DEMO_TENANT,
          persona: u.persona,
          displayName: u.displayName,
          role: u.role,
          isDemo: true,
          publishers: { create: u.publishers.map((publisherId) => ({ publisherId })) },
        },
      });
    }
    await tx.serviceKey.create({
      data: { id: "key_bidder", tenantId: DEMO_TENANT, name: "Bidder (server-side only)", role: "bidder_service", keyHash: hashKey(keys.bidderKey), keyPrefix: keys.bidderKey.slice(0, 8) },
    });
    await tx.serviceKey.create({
      data: { id: "key_demo_readonly", tenantId: DEMO_TENANT, name: "Evaluator read-only (README)", role: "demo_readonly", keyHash: hashKey(keys.readonlyKey), keyPrefix: keys.readonlyKey.slice(0, 8) },
    });
    await tx.auditEvent.create({
      data: { tenantId: DEMO_TENANT, actorType: "system", actorId: "seed", action: "demo.seeded", entityType: "tenant", entityId: DEMO_TENANT },
    });
  });
}
