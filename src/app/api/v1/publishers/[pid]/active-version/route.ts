import { z } from "zod";
import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { jsonBody } from "@/lib/http/body";
import { handler, json } from "@/lib/http/problem";
import { activate } from "@/lib/services/versions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

/** PUT /v1/publishers/{pid}/active-version { version } — reviewer. Idempotent; rollback is the same call. */
export const PUT = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["reviewer"]);
  const { pid } = await ctx.params;
  await scopedPublisher(p, pid);
  const body = await jsonBody(req, z.object({ version: z.number().int().min(1) }).strict(), 1024);
  return json(requestId, { publisher_id: pid, ...(await activate(p, pid, body.version)) });
});
