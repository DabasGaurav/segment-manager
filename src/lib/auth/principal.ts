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
 * CSRF defence for cookie-authenticated writes (in addition to SameSite=Strict).
 * The Origin header must be present and match:
 *  - one of APP_ORIGIN (comma-separated, full scheme://host[:port]) when set, else
 *  - the scheme and host of the URL the request was actually sent to.
 * X-Forwarded-Host is never trusted here (it is client-controllable on self-hosted setups).
 */
export function assertSameOrigin(req: Request): void {
  if (!MUTATING.has(req.method.toUpperCase())) return;
  const reject = (why: string) => new ApiError(403, "CSRF_ORIGIN_MISMATCH", `Cross-site write rejected (${why}).`);
  const origin = req.headers.get("origin");
  if (!origin) throw reject("missing Origin");
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw reject("bad Origin");
  }
  const configured = (process.env.APP_ORIGIN ?? "")
    .split(",")
    .map((x) => x.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (configured.length > 0) {
    if (!configured.includes(o.origin)) throw reject("Origin not allowed");
    return;
  }
  const self = new URL(req.url);
  const host = req.headers.get("host") ?? self.host;
  if (o.host !== host) throw reject("Origin host mismatch");
  if (o.protocol !== self.protocol && !(o.protocol === "https:" && self.protocol === "http:")) {
    // Behind TLS-terminating proxies the internal URL may say http while the browser used https.
    throw reject("Origin scheme mismatch");
  }
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
 *
 * Service principals are refused unless the route explicitly opts in (only /v1/resolve does,
 * and only for the publisher named in that request). This keeps control data unreachable by keys
 * even if a future route forgets its role list.
 */
export async function scopedPublisher(p: Principal, publisherId: string, opts: { allowService?: readonly ServiceRole[] } = {}) {
  const notFound = new ApiError(404, "PUBLISHER_NOT_FOUND", "Publisher not found.");
  if (!/^pub_[a-z0-9_]{1,60}$/.test(publisherId)) throw notFound;
  if (p.kind === "service") {
    if (!opts.allowService?.includes(p.role)) throw notFound;
  } else {
    if (p.role === "curator") throw notFound; // curators never see publisher internals
    if (p.role !== "admin" && !p.publisherIds.includes(publisherId)) throw notFound;
  }
  const pub = await prisma.publisher.findFirst({ where: { id: publisherId, tenantId: p.tenantId } });
  if (!pub) throw notFound;
  return pub;
}
