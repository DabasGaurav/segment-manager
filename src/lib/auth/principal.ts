/**
 * Who is calling, and what may they touch.
 *
 *  - People (UI and API): demo session cookie -> User row (role + publisher assignments).
 *  - Services: `Authorization: Bearer <key>` -> ServiceKey row (only the SHA-256 hash is stored).
 *
 * A request that presents a bearer token is judged on that token alone; it never falls back to a cookie.
 */
import type { Role, ServiceRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { ApiError } from "@/lib/http/problem";
import { hashKey } from "./keys";
import { readCookie, SESSION_COOKIE, verifySession } from "./session";

export type Principal =
  | { kind: "user"; id: string; tenantId: string; role: Role; persona: string; displayName: string; publisherIds: string[] }
  | { kind: "service"; id: string; tenantId: string; role: ServiceRole; name: string };

export type AnyRole = Role | ServiceRole;

export { hashKey };

export async function authenticate(req: Request): Promise<Principal | null> {
  const authz = req.headers.get("authorization");
  if (authz !== null) {
    const m = authz.match(/^Bearer ([A-Za-z0-9_\-]{16,200})$/);
    if (!m) return null;
    const key = await prisma.serviceKey.findUnique({ where: { keyHash: hashKey(m[1]!) } });
    if (!key || key.revokedAt) return null;
    return { kind: "service", id: key.id, tenantId: key.tenantId, role: key.role, name: key.name };
  }
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.sub }, include: { publishers: true } });
  if (!user || user.tenantId !== claims.tid) return null;
  return {
    kind: "user",
    id: user.id,
    tenantId: user.tenantId,
    role: user.role,
    persona: user.persona,
    displayName: user.displayName,
    publisherIds: user.publishers.map((p) => p.publisherId),
  };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated writes (in addition to SameSite=Strict):
 * the Origin header must be present and match the Host the request was sent to.
 */
export function assertSameOrigin(req: Request): void {
  if (!MUTATING.has(req.method.toUpperCase())) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) throw new ApiError(403, "CSRF_ORIGIN_MISMATCH", "Cross-site write rejected (missing Origin).");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "CSRF_ORIGIN_MISMATCH", "Cross-site write rejected (bad Origin).");
  }
  if (originHost !== host) throw new ApiError(403, "CSRF_ORIGIN_MISMATCH", "Cross-site write rejected.");
}

/**
 * Authenticate and authorise. `roles` lists every role allowed; omit to allow any authenticated caller.
 */
export async function requirePrincipal(req: Request, roles?: readonly AnyRole[]): Promise<Principal> {
  const p = await authenticate(req);
  if (!p) throw new ApiError(401, "UNAUTHENTICATED", "Sign in with a demo persona, or send a valid service key.", undefined, { "www-authenticate": "Bearer" });
  if (p.kind === "user") assertSameOrigin(req);
  if (roles && !roles.includes(p.role)) {
    throw new ApiError(403, "FORBIDDEN_ROLE", `Role ${p.role} cannot call this endpoint.`);
  }
  return p;
}

/**
 * Tenant isolation (Phase 3.1 §A3.4). Returns the publisher only if the caller may see it.
 * Out-of-scope and non-existent publishers are indistinguishable: both are 404.
 */
export async function scopedPublisher(p: Principal, publisherId: string) {
  const notFound = new ApiError(404, "PUBLISHER_NOT_FOUND", `Publisher ${publisherId} was not found.`);
  if (!/^pub_[a-z0-9_]{1,60}$/.test(publisherId)) throw notFound;
  if (p.kind === "user" && p.role !== "admin" && !p.publisherIds.includes(publisherId)) throw notFound;
  if (p.kind === "user" && p.role === "curator") throw notFound; // curators never see publisher internals
  const pub = await prisma.publisher.findFirst({ where: { id: publisherId, tenantId: p.tenantId } });
  if (!pub) throw notFound;
  return pub;
}
