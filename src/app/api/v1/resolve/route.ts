import { requirePrincipal } from "@/lib/auth/principal";
import { handler, json, readBodyLimited, requireJsonContentType } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/ratelimit";
import { MAX_BODY_BYTES } from "@/lib/openrtb/envelope";
import { runResolve } from "@/lib/services/resolve-service";

export const dynamic = "force-dynamic";

/**
 * POST /v1/resolve — service keys only (bidder_service; the evaluator read-only key on the demo tenant).
 * Body: { publisher_id, dsp, bid_request }. Returns the rewritten request plus one decision per signal.
 */
export const POST = handler(async (req, _ctx, requestId) => {
  const p = await requirePrincipal(req, ["bidder_service", "demo_readonly"]);
  if (p.kind === "service" && p.role === "demo_readonly") rateLimit(`resolve:${p.id}`, 60);
  requireJsonContentType(req);
  const out = await runResolve(p, await readBodyLimited(req, MAX_BODY_BYTES), "api");
  return json(requestId, out as unknown as Record<string, unknown>);
});
