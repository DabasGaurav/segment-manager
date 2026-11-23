import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { handler, json } from "@/lib/http/problem";
import { registryOr503 } from "@/lib/http/registry";
import { prisma } from "@/lib/db/client";
import { publish, serializeVersion } from "@/lib/services/versions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

/** GET /v1/publishers/{pid}/mapping-versions — publisher_ops, reviewer, admin. */
export const GET = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["publisher_ops", "reviewer", "admin"]);
  const { pid } = await ctx.params;
  const pub = await scopedPublisher(p, pid);
  const versions = await prisma.mappingVersion.findMany({ where: { publisherId: pid }, orderBy: { number: "desc" }, take: 50 });
  return json(requestId, { publisher_id: pid, active_version: pub.activeVersionNumber, versions: versions.map((v) => serializeVersion(v, pub.activeVersionNumber, true)) });
});

/** POST /v1/publishers/{pid}/mapping-versions — reviewer: publish approved mappings as a new immutable version. */
export const POST = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["reviewer"]);
  const { pid } = await ctx.params;
  await scopedPublisher(p, pid);
  return json(requestId, { publisher_id: pid, ...(await publish(registryOr503(), p, pid)) }, 201);
});
