import { requirePrincipal } from "@/lib/auth/principal";
import { ApiError, handler, json, readBodyLimited, requireJsonContentType } from "@/lib/http/problem";
import { detectSignals } from "@/lib/openrtb/detect";
import { MAX_BODY_BYTES, parseEnvelope } from "@/lib/openrtb/envelope";
import { getRegistry } from "@/lib/taxonomy/registry";

export const dynamic = "force-dynamic";

/**
 * POST /api/lab/inspect — UI-only route behind the demo session (Checkpoint 1).
 * Runs envelope validation and the L0 detector on a bid request. Read-only: stores nothing.
 * From Checkpoint 2 the Bid Request Lab calls /v1/resolve through a server-side route instead.
 */
export const POST = handler(async (req, _ctx, requestId) => {
  await requirePrincipal(req, ["publisher_ops", "reviewer", "curator", "admin"]);
  requireJsonContentType(req);
  const env = parseEnvelope(await readBodyLimited(req, MAX_BODY_BYTES));
  if (!env.ok) throw new ApiError(env.status, env.code, env.detail, env.errors);
  let reg;
  try {
    reg = getRegistry();
  } catch {
    throw new ApiError(503, "TAXONOMY_UNAVAILABLE", "Official taxonomy files failed verification.", undefined, { "retry-after": "60" });
  }
  return json(requestId, { detection: detectSignals(reg, env.value.bid_request) });
});
