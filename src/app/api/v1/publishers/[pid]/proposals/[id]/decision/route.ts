import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { jsonBody } from "@/lib/http/body";
import { ApiError, handler, json } from "@/lib/http/problem";
import { registryOr503 } from "@/lib/http/registry";
import { decide, decisionSchema } from "@/lib/services/proposals";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string; id: string }> };

/**
 * POST /v1/publishers/{pid}/proposals/{id}/decision — reviewer only.
 * { action: approve | choose_other | abstain | revoke, target?, reclassify_to?, note?, row_version }
 */
export const POST = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["reviewer"]);
  const { pid, id } = await ctx.params;
  await scopedPublisher(p, pid);
  if (!/^[a-z0-9]{10,40}$/.test(id)) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  const body = await jsonBody(req, decisionSchema, 8 * 1024);
  return json(requestId, { proposal: await decide(registryOr503(), p, pid, id, body) });
});
