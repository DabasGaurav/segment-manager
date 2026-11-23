import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { ApiError, handler, json } from "@/lib/http/problem";
import { prisma } from "@/lib/db/client";
import { serializeProposal } from "@/lib/services/proposals";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };
const STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "ABSTAINED", "BLOCKED", "SUPERSEDED", "REVOKED"] as const;

/** GET /v1/publishers/{pid}/proposals?status=PENDING_REVIEW — publisher_ops (read), reviewer, admin. */
export const GET = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["publisher_ops", "reviewer", "admin"]);
  const { pid } = await ctx.params;
  await scopedPublisher(p, pid);
  const status = new URL(req.url).searchParams.get("status");
  if (status !== null && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new ApiError(400, "SCHEMA_VIOLATION", `status must be one of ${STATUSES.join(", ")}.`);
  }
  const rows = await prisma.proposal.findMany({
    where: { publisherId: pid, ...(status ? { status: status as (typeof STATUSES)[number] } : { status: { not: "SUPERSEDED" } }) },
    orderBy: [{ createdAt: "asc" }, { rawId: "asc" }],
    take: 500,
  });
  return json(requestId, { publisher_id: pid, proposals: rows.map(serializeProposal) });
});
