/**
 * Append-only audit trail. Never pass bid-request contents here: only ids, decisions and versions.
 * (The DB trigger blocks UPDATE/DELETE/TRUNCATE; this module only inserts.)
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Principal } from "@/lib/auth/principal";

type Tx = Prisma.TransactionClient | PrismaClient;

export const hashRequestId = (id: string): string => createHash("sha256").update(`bidreq:${id}`).digest("hex").slice(0, 32);

export async function audit(
  tx: Tx,
  actor: Principal | { kind: "system"; id: string; tenantId: string },
  e: {
    publisherId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: Prisma.InputJsonValue | null;
    after?: Prisma.InputJsonValue | null;
    mappingVersion?: number | null;
    requestIdHash?: string | null;
  },
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      publisherId: e.publisherId ?? null,
      actorType: actor.kind,
      actorId: actor.kind === "user" ? `${actor.persona} (${actor.role})` : actor.kind === "service" ? `${actor.name} (${actor.role})` : actor.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before ?? undefined,
      after: e.after ?? undefined,
      mappingVersion: e.mappingVersion ?? null,
      requestIdHash: e.requestIdHash ?? null,
    },
  });
}
