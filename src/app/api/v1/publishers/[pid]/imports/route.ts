import { requirePrincipal, scopedPublisher } from "@/lib/auth/principal";
import { jsonBody } from "@/lib/http/body";
import { ApiError, handler, json } from "@/lib/http/problem";
import { registryOr503 } from "@/lib/http/registry";
import { rateLimit } from "@/lib/http/ratelimit";
import { createImport, importSchema } from "@/lib/services/proposals";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ pid: string }> };

/**
 * POST /v1/publishers/{pid}/imports — publisher_ops.
 * Upload a signal dictionary and/or sample bid requests. Runs detection and the mapper and creates proposals.
 * Idempotent with the Idempotency-Key header.
 */
export const POST = handler<Ctx>(async (req, ctx, requestId) => {
  const p = await requirePrincipal(req, ["publisher_ops"]);
  const { pid } = await ctx.params;
  const pub = await scopedPublisher(p, pid);
  rateLimit(`import:${p.id}`, 30);
  const key = req.headers.get("idempotency-key");
  if (key !== null && !/^[A-Za-z0-9_.:-]{1,100}$/.test(key)) throw new ApiError(400, "SCHEMA_VIOLATION", "Idempotency-Key must be 1-100 safe characters.");
  const body = await jsonBody(req, importSchema, 256 * 1024);
  const out = await createImport(registryOr503(), p, pub, body, key);
  return json(requestId, out as Record<string, unknown>, out.replayed ? 200 : 201);
});
