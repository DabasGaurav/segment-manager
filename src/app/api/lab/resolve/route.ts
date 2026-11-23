import { prisma } from "@/lib/db/client";
import { hashKey } from "@/lib/auth/keys";
import { requirePrincipal, type Principal } from "@/lib/auth/principal";
import { ApiError, handler, json, readBodyLimited, requireJsonContentType } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/ratelimit";
import { MAX_BODY_BYTES } from "@/lib/openrtb/envelope";
import { runResolve } from "@/lib/services/resolve-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/lab/resolve — the Bid Request Lab (any signed-in demo persona).
 * Runs the exact /v1/resolve code as the bidder service identity, server-side. The service key never
 * reaches the browser. 30 requests per minute per session.
 */
export const POST = handler(async (req, _ctx, requestId) => {
  const user = await requirePrincipal(req, ["publisher_ops", "reviewer", "curator", "admin"]);
  rateLimit(`lab:${user.id}`, 30);
  requireJsonContentType(req);
  const key = process.env.BIDDER_SERVICE_KEY ?? "";
  const row = key ? await prisma.serviceKey.findUnique({ where: { keyHash: hashKey(key) } }) : null;
  if (!row || row.revokedAt || row.role !== "bidder_service" || row.tenantId !== user.tenantId) {
    throw new ApiError(503, "LAB_UNAVAILABLE", "The bidder service key is not configured on this deployment.");
  }
  const bidder: Principal = { kind: "service", id: row.id, tenantId: row.tenantId, role: row.role, name: `${row.name} via lab (${user.kind === "user" ? user.persona : ""})` };
  const out = await runResolve(bidder, await readBodyLimited(req, MAX_BODY_BYTES), "lab");
  return json(requestId, out as unknown as Record<string, unknown>);
});
