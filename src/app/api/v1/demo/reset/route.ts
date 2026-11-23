import { prisma } from "@/lib/db/client";
import { requirePrincipal } from "@/lib/auth/principal";
import { demoModeEnabled } from "@/lib/auth/session";
import { seedDemo } from "@/lib/db/seed";
import { ApiError, handler, json } from "@/lib/http/problem";
import { rateLimit } from "@/lib/http/ratelimit";

export const dynamic = "force-dynamic";

/** POST /v1/demo/reset — demo only: wipe and re-seed the synthetic demo tenant. Any signed-in persona. */
export const POST = handler(async (req, _ctx, requestId) => {
  if (!demoModeEnabled()) throw new ApiError(404, "NOT_FOUND", "Demo reset is disabled.");
  const p = await requirePrincipal(req, ["publisher_ops", "reviewer", "curator", "admin"]);
  rateLimit(`reset:${p.tenantId}`, 6);
  const bidderKey = process.env.BIDDER_SERVICE_KEY ?? "";
  const readonlyKey = process.env.DEMO_READONLY_KEY ?? "";
  if (bidderKey.length < 24 || readonlyKey.length < 24) throw new ApiError(503, "RESET_UNAVAILABLE", "Service keys are not configured.");
  await seedDemo(prisma, { bidderKey, readonlyKey });
  return json(requestId, { reset: true, by: p.kind === "user" ? p.persona : p.name });
});
