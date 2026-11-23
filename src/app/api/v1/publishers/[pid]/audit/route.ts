import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { ApiError, handler, json } from "@/lib/http/problem";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

/** GET /v1/publishers/{pid}/audit?since=ISO — publisher_ops, reviewer, admin (own publishers). */
export const GET = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["publisher_ops", "reviewer", "admin"]);
  const { pid } = await ctx.params;
  await scopedPublisher(p, pid);
  const sinceRaw = new URL(req.url).searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (since && Number.isNaN(since.getTime())) throw new ApiError(400, "SCHEMA_VIOLATION", "since must be an ISO-8601 time.");
  const events = await prisma.auditEvent.findMany({
    where: { tenantId: p.tenantId, publisherId: pid, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json(requestId, {
    publisher_id: pid,
    events: events.map((e) => ({
      at: e.createdAt,
      actor: e.actorId,
      actor_type: e.actorType,
      action: e.action,
      entity: e.entityId ? `${e.entityType}:${e.entityId}` : e.entityType,
      mapping_version: e.mappingVersion,
      request_id_hash: e.requestIdHash,
      before: e.before,
      after: e.after,
    })),
  });
});
