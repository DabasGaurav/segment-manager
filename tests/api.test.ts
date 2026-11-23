/** Route handlers called in-process against the test database. */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "@/lib/db/seed";
import { signSession } from "@/lib/auth/session";
import { GET as health } from "@/app/api/health/route";
import { GET as nodeGET } from "@/app/api/v1/taxonomies/[taxonomy]/[version]/nodes/[id]/route";
import { POST as sessionPOST, DELETE as sessionDELETE } from "@/app/api/v1/demo/sessions/route";
import { POST as inspectPOST } from "@/app/api/lab/inspect/route";
import { bidRequest } from "./fixtures";

const prisma = new PrismaClient();
const HOST = "sm.test";
const BIDDER = process.env.BIDDER_SERVICE_KEY!;
const READONLY = process.env.DEMO_READONLY_KEY!;

beforeAll(async () => {
  await seedDemo(prisma, { bidderKey: BIDDER, readonlyKey: READONLY });
});
afterAll(() => prisma.$disconnect());

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Request(`http://${HOST}${path}`, { method: init.method ?? "GET", headers: { host: HOST, ...(init.headers ?? {}) }, body: init.body });
}
async function login(persona: string): Promise<string> {
  const res = await sessionPOST(
    req("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json", origin: `http://${HOST}` }, body: JSON.stringify({ persona }) }),
    undefined,
  );
  expect(res.status).toBe(201);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Strict/);
  return cookie.split(";")[0]!;
}
const nodeCtx = (taxonomy: string, version: string, id: string) => ({ params: Promise.resolve({ taxonomy, version, id }) });

describe("health", () => {
  it("reports database and verified taxonomy files", async () => {
    const res = await health(req("/health"), undefined);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", database: "ok", taxonomy_files: "verified" });
    expect(body.taxonomies).toHaveLength(4);
    expect(res.headers.get("x-request-id")).toBe(body.request_id);
  });
});

describe("GET /v1/taxonomies/{taxonomy}/{version}/nodes/{id}", () => {
  it("401 without credentials, as problem+json", async () => {
    const res = await nodeGET(req("/v1/taxonomies/content/3.0/nodes/22"), nodeCtx("content", "3.0", "22"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect((await res.json()).code).toBe("UNAUTHENTICATED");
  });
  it("200 with a demo session", async () => {
    const cookie = await login("reviewer.drivedesk");
    const res = await nodeGET(req("/v1/taxonomies/content/3.0/nodes/22", { headers: { cookie } }), nodeCtx("content", "3.0", "22"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ taxonomy: "content", version: "3.0", segtax: 7, node: { id: "22", name: "Green Vehicles", parent: { id: "16", name: "Auto Type" } } });
    expect(body.source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("200 with a service key; 401 with a wrong, malformed or revoked key", async () => {
    const ok = await nodeGET(req("/x", { headers: { authorization: `Bearer ${READONLY}` } }), nodeCtx("audience", "1.1", "824"));
    expect(ok.status).toBe(200);
    for (const h of [`Bearer ${READONLY}x`, `Bearer`, `Basic ${READONLY}`, `Bearer ${READONLY} extra`, ""]) {
      const res = await nodeGET(req("/x", { headers: { authorization: h } }), nodeCtx("audience", "1.1", "824"));
      expect(res.status, h).toBe(401);
    }
    await prisma.serviceKey.update({ where: { id: "key_demo_readonly" }, data: { revokedAt: new Date() } });
    const revoked = await nodeGET(req("/x", { headers: { authorization: `Bearer ${READONLY}` } }), nodeCtx("audience", "1.1", "824"));
    expect(revoked.status).toBe(401);
    await prisma.serviceKey.update({ where: { id: "key_demo_readonly" }, data: { revokedAt: null } });
  });
  it("a bad bearer token never falls back to a valid cookie", async () => {
    const cookie = await login("admin");
    const res = await nodeGET(req("/x", { headers: { cookie, authorization: "Bearer nope-nope-nope-nope" } }), nodeCtx("content", "3.0", "22"));
    expect(res.status).toBe(401);
  });
  it("404 NODE_NOT_FOUND and TAXONOMY_NOT_FOUND", async () => {
    const h = { authorization: `Bearer ${READONLY}` };
    const a = await nodeGET(req("/x", { headers: h }), nodeCtx("content", "3.0", "99999"));
    expect([a.status, (await a.json()).code]).toEqual([404, "NODE_NOT_FOUND"]);
    const b = await nodeGET(req("/x", { headers: h }), nodeCtx("content", "9.9", "22"));
    expect([b.status, (await b.json()).code]).toEqual([404, "TAXONOMY_NOT_FOUND"]);
    const c = await nodeGET(req("/x", { headers: h }), nodeCtx("__proto__", "x", "22"));
    expect(c.status).toBe(404);
  });
});

describe("demo sessions and session security", () => {
  it("unknown persona 404; malformed body 400; cross-site 403", async () => {
    const post = (body: string, headers: Record<string, string> = {}) =>
      sessionPOST(req("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json", origin: `http://${HOST}`, ...headers }, body }), undefined);
    expect((await post(JSON.stringify({ persona: "nobody" }))).status).toBe(404);
    expect((await post("{")).status).toBe(400);
    expect((await post(JSON.stringify({ persona: "admin", role: "admin" }))).status).toBe(400);
    expect((await post(JSON.stringify({ persona: "admin" }), { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await sessionPOST(req("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: "admin" }) }), undefined);
    expect(noOrigin.status).toBe(403);
  });
  it("is disabled entirely when DEMO_MODE is not true", async () => {
    process.env.DEMO_MODE = "false";
    try {
      const res = await sessionPOST(req("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json", origin: `http://${HOST}` }, body: JSON.stringify({ persona: "admin" }) }), undefined);
      expect(res.status).toBe(404);
    } finally {
      process.env.DEMO_MODE = "true";
    }
  });
  it("rejects tampered, foreign-secret and expired tokens; deleted users lose access", async () => {
    const cookie = await login("reviewer.drivedesk");
    const token = cookie.split("=")[1]!;
    const [h, p, s] = token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "usr_admin", tid: "ten_demo", iss: "segment-manager", aud: "segment-manager-ui", exp: 9999999999 })).toString("base64url")}.${s}`;
    const call = (c: string) => nodeGET(req("/x", { headers: { cookie: c } }), nodeCtx("content", "3.0", "22"));
    expect((await call(`sm_session=${tampered}`)).status).toBe(401);
    expect((await call(`sm_session=${h}.${p}.`)).status).toBe(401);
    expect((await call(`sm_session=eyJhbGciOiJub25lIn0.${p}.`)).status).toBe(401);
    const secret = process.env.SESSION_SECRET!;
    process.env.SESSION_SECRET = "another-secret-0123456789abcdef0123456789";
    const foreign = await signSession({ sub: "usr_admin", tid: "ten_demo" });
    process.env.SESSION_SECRET = secret;
    expect((await call(`sm_session=${foreign}`)).status).toBe(401);
    const ghost = await signSession({ sub: "usr_does_not_exist", tid: "ten_demo" });
    expect((await call(`sm_session=${ghost}`)).status).toBe(401);
    const wrongTenant = await signSession({ sub: "usr_admin", tid: "ten_other" });
    expect((await call(`sm_session=${wrongTenant}`)).status).toBe(401);
  });
  it("sign-out clears the cookie", async () => {
    const res = await sessionDELETE(req("/v1/demo/sessions", { method: "DELETE", headers: { origin: `http://${HOST}` } }), undefined);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("POST /api/lab/inspect (UI-only, session required)", () => {
  const body = JSON.stringify({
    publisher_id: "pub_metrodaily",
    dsp: "ttd",
    bid_request: bidRequest({ user: { data: [{ name: "metrodaily.example", ext: { segtax: 4 }, segment: [{ id: "253" }, { id: "99999" }] }] } }),
  });
  const call = (headers: Record<string, string>, b = body) =>
    inspectPOST(req("/api/lab/inspect", { method: "POST", headers: { "content-type": "application/json", origin: `http://${HOST}`, ...headers }, body: b }), undefined);

  it("runs detection for a signed-in persona", async () => {
    const cookie = await login("ops.drivedesk");
    const res = await call({ cookie });
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.detection.data_objects[0].segments.map((s: { next_step: string }) => s.next_step)).toEqual(["PASS_THROUGH_SUBJECT_TO_POLICY", "REMOVE"]);
  });
  it("service keys cannot use the UI lab route", async () => {
    expect((await call({ authorization: `Bearer ${BIDDER}` })).status).toBe(403);
  });
  it("cross-site POST with a valid cookie is rejected", async () => {
    const cookie = await login("ops.drivedesk");
    expect((await call({ cookie, origin: "https://evil.example" })).status).toBe(403);
  });
  it("wrong content type 415; oversize 413 before parsing", async () => {
    const cookie = await login("ops.drivedesk");
    expect((await call({ cookie, "content-type": "text/plain" })).status).toBe(415);
    const big = JSON.stringify({ publisher_id: "pub_x", dsp: "ttd", bid_request: { id: "a", imp: [{}], pad: "x".repeat(70000) } });
    const res = await call({ cookie }, big);
    expect([res.status, (await res.json()).code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
  });
});

describe("append-only storage", () => {
  it("audit events cannot be updated or deleted outside a demo reset", async () => {
    await expect(prisma.auditEvent.updateMany({ data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
  });
});
