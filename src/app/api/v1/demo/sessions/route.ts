import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { assertSameOrigin } from "@/lib/auth/principal";
import { clearedSessionCookie, demoModeEnabled, sessionCookie, signSession } from "@/lib/auth/session";
import { ApiError, handler, json, readBodyLimited, requireJsonContentType } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ persona: z.string().regex(/^[a-z0-9_.-]{1,60}$/) }).strict();

/**
 * POST /v1/demo/sessions { persona }  — demo only (DEMO_MODE=true).
 * Signs in as a seeded demo persona. Cannot mint service keys; cannot call /v1/resolve.
 */
export const POST = handler(async (req, _ctx, requestId) => {
  if (!demoModeEnabled()) throw new ApiError(404, "NOT_FOUND", "Demo sessions are disabled.");
  assertSameOrigin(req);
  requireJsonContentType(req);
  const raw = await readBodyLimited(req, 1024);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Body is not valid JSON.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "SCHEMA_VIOLATION", "Expected { persona }.");
  const user = await prisma.user.findUnique({ where: { persona: parsed.data.persona }, include: { publishers: true } });
  if (!user || !user.isDemo) throw new ApiError(404, "PERSONA_NOT_FOUND", "No such demo persona.");
  const token = await signSession({ sub: user.id, tid: user.tenantId });
  return json(
    requestId,
    {
      persona: user.persona,
      display_name: user.displayName,
      role: user.role,
      publisher_ids: user.publishers.map((p) => p.publisherId),
      expires_in: 8 * 60 * 60,
    },
    201,
    { "set-cookie": sessionCookie(token) },
  );
});

/** DELETE /v1/demo/sessions — sign out. */
export const DELETE = handler(async (req, _ctx, requestId) => {
  assertSameOrigin(req);
  return json(requestId, { signed_out: true }, 200, { "set-cookie": clearedSessionCookie() });
});
