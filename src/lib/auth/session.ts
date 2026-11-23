/**
 * Demo session tokens (Phase 3.1 §A3.3): HS256 JWT in an httpOnly, SameSite=Strict cookie, 8 h.
 * Issued only for seeded demo personas, and only when DEMO_MODE=true.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "sm_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ISSUER = "segment-manager";
const AUDIENCE = "segment-manager-ui";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(s);
}

export interface SessionClaims {
  sub: string; // user id
  tid: string; // tenant id
}

export async function signSession(c: SessionClaims): Promise<string> {
  return new SignJWT({ tid: c.tid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(c.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

/** Returns claims, or null for any invalid, expired, tampered or wrongly-signed token. */
export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.tid !== "string") return null;
    return { sub: payload.sub, tid: payload.tid };
  } catch {
    return null;
  }
}

export function demoModeEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
