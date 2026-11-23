import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { jsonBody } from "@/lib/http/body";
import { handler, json } from "@/lib/http/problem";
import { prisma } from "@/lib/db/client";
import { grantSchema, putGrant, serializeGrant } from "@/lib/services/versions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

/** GET /v1/publishers/{pid}/grant — publisher_ops, reviewer, admin. */
export const GET = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["publisher_ops", "reviewer", "admin"]);
  const { pid } = await ctx.params;
  await scopedPublisher(p, pid);
  return json(requestId, { publisher_id: pid, grant: serializeGrant(await prisma.grant.findUnique({ where: { publisherId: pid } })) });
});

/**
 * PUT /v1/publishers/{pid}/grant — publisher_ops only (separation of duties: whoever approves
 * mappings cannot also grant their use).
 */
export const PUT = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["publisher_ops"]);
  const { pid } = await ctx.params;
  await scopedPublisher(p, pid);
  const body = await jsonBody(req, grantSchema, 8 * 1024);
  return json(requestId, { publisher_id: pid, grant: await putGrant(p, pid, body) });
});
