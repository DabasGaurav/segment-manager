/**
 * End-to-end API flow through the real route handlers and the test database:
 * import -> review -> grant -> publish -> activate -> resolve -> rollback -> audit,
 * plus the security, concurrency and failure cases from the Phase 3.1 test matrix (T08-T22).
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemo } from "@/lib/db/seed";
import { __resetRateLimitsForTests } from "@/lib/http/ratelimit";
import { DRIVEDESK_DICTIONARY, DRIVEDESK_SAMPLE, nexonRequest } from "@/lib/demo/dictionary";
import { POST as sessionPOST } from "@/app/api/v1/demo/sessions/route";
import { POST as importPOST } from "@/app/api/v1/publishers/[pid]/imports/route";
import { GET as proposalsGET } from "@/app/api/v1/publishers/[pid]/proposals/route";
import { POST as decisionPOST } from "@/app/api/v1/publishers/[pid]/proposals/[id]/decision/route";
import { GET as grantGET, PUT as grantPUT } from "@/app/api/v1/publishers/[pid]/grant/route";
import { GET as versionsGET, POST as versionsPOST } from "@/app/api/v1/publishers/[pid]/mapping-versions/route";
import { PUT as activePUT } from "@/app/api/v1/publishers/[pid]/active-version/route";
import { GET as auditGET } from "@/app/api/v1/publishers/[pid]/audit/route";
import { POST as resolvePOST } from "@/app/api/v1/resolve/route";
import { POST as labResolvePOST } from "@/app/api/lab/resolve/route";
import { POST as resetPOST } from "@/app/api/v1/demo/reset/route";

const prisma = new PrismaClient();
const HOST = "sm.test";
const BIDDER = process.env.BIDDER_SERVICE_KEY!;
const READONLY = process.env.DEMO_READONLY_KEY!;
const PID = "pub_drivedesk";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const cookies: Record<string, string> = {};

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const body = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  return new Request(`http://${HOST}${path}`, {
    method: init.method ?? "GET",
    headers: { host: HOST, origin: `http://${HOST}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    body,
  });
}
async function as(persona: string): Promise<Record<string, string>> {
  if (!cookies[persona]) {
    const res = await sessionPOST(req("/v1/demo/sessions", { method: "POST", body: { persona } }), undefined);
    expect(res.status).toBe(201);
    cookies[persona] = res.headers.get("set-cookie")!.split(";")[0]!;
  }
  return { cookie: cookies[persona]! };
}
const P = (pid = PID) => ({ params: Promise.resolve({ pid }) });
const PI = (id: string, pid = PID) => ({ params: Promise.resolve({ pid, id }) });
async function body(res: Response): Promise<Json> {
  return (await res.json()) as Json;
}

async function importDictionary(headers: Record<string, string> = {}) {
  return importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: { ...(await as("ops.drivedesk")), ...headers }, body: { entries: DRIVEDESK_DICTIONARY, samples: [DRIVEDESK_SAMPLE] } }), P());
}
async function proposals(status?: string): Promise<Json[]> {
  const res = await proposalsGET(req(`/v1/publishers/${PID}/proposals${status ? `?status=${status}` : ""}`, { headers: await as("reviewer.drivedesk") }), P());
  return (await body(res)).proposals;
}
const byRaw = (ps: Json[], raw: string) => ps.find((p) => p.raw_id === raw)!;
async function decideAs(persona: string, id: string, b: Json, pid = PID) {
  return decisionPOST(req(`/v1/publishers/${pid}/proposals/${id}/decision`, { method: "POST", headers: await as(persona), body: b }), PI(id, pid));
}
async function resolve(bid: unknown, opts: { dsp?: string; key?: string; publisher_id?: string } = {}) {
  return resolvePOST(
    req("/v1/resolve", { method: "POST", headers: { authorization: `Bearer ${opts.key ?? BIDDER}`, origin: "" }, body: { publisher_id: opts.publisher_id ?? PID, dsp: opts.dsp ?? "ttd", bid_request: bid } }),
    undefined,
  );
}
const outcomes = (r: Json) => Object.fromEntries((r.decisions as Json[]).map((d) => [`${d.path}:${d.raw_id}`, `${d.outcome}${d.to ? `->${d.to.segtax}/${d.to.id}` : ""}`]));

beforeAll(async () => {
  await seedDemo(prisma, { bidderKey: BIDDER, readonlyKey: READONLY });
});
beforeEach(() => __resetRateLimitsForTests());
afterAll(() => prisma.$disconnect());

describe("before onboarding (G0)", () => {
  it("T19a valid standard signals pass through without any grant; proprietary IDs untouched", async () => {
    const res = await resolve(nexonRequest("eu-consented"));
    const r = await body(res);
    expect(res.status).toBe(200);
    expect(r.status).toBe("OK");
    const o = outcomes(r);
    expect(o["user.data[1].segment[0]:253"]).toBe("PASSED_THROUGH");
    expect(o["user.data[1].segment[1]:99999"]).toBe("REMOVED");
    expect(o["site.content.data[0].segment[0]:ev-news"]).toBe("KEPT_RAW");
    expect((r.decisions as Json[]).find((d) => d.raw_id === "ev-news")!.reason_codes).toContain("PUBLISHER_NOT_ONBOARDED");
    expect(r.mapping_version).toBeNull();
    // Output keeps the valid object minus the bad ID; other fields untouched.
    expect(r.bid_request.user.data[1]).toEqual({ name: "metrodaily.example", ext: { segtax: 4 }, segment: [{ id: "253" }] });
    expect(r.bid_request.imp).toEqual(nexonRequest("eu-consented").imp);
  });
});

describe("import and mapping proposals (T10-T13)", () => {
  it("only publisher_ops can import; other publishers are 404", async () => {
    const r1 = await importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: await as("reviewer.drivedesk"), body: { entries: [] } }), P());
    expect(r1.status).toBe(403);
    const r2 = await importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: await as("ops.metrodaily"), body: { entries: [] } }), P());
    expect([r2.status, (await body(r2)).code]).toEqual([404, "PUBLISHER_NOT_FOUND"]);
    const r3 = await importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: { authorization: `Bearer ${BIDDER}` }, body: { entries: [] } }), P());
    expect(r3.status).toBe(403);
  });

  it("rejects class/field mismatches and duplicates as a whole (nothing stored)", async () => {
    const bad = { entries: [{ raw_id: "x", field: "content", label: "X", declared_class: "AUDIENCE_INTEREST" }, { raw_id: "y", field: "user", label: "Y", declared_class: "AUDIENCE_INTEREST" }, { raw_id: "y", field: "user", label: "Y2", declared_class: "AUDIENCE_INTEREST" }] };
    const res = await importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: await as("ops.drivedesk"), body: bad }), P());
    const b = await body(res);
    expect(res.status).toBe(422);
    expect(b.errors.map((e: Json) => e.message.split(":")[0])).toEqual(["CLASS_FIELD_MISMATCH", "DUPLICATE_ENTRY"]);
    expect(await prisma.dictionaryEntry.count({ where: { publisherId: PID } })).toBe(0);
  });

  it("creates proposals: broader content match, exact auto-approval, intent held for review, sensitive blocked, unknown abstained", async () => {
    const res = await importDictionary({ "idempotency-key": "import-1" });
    const b = await body(res);
    expect(res.status).toBe(201);
    expect(b.summary).toMatchObject({ entries: 5, proposals_created: 6, auto_approved: 1, blocked: 1 });
    const ps = await proposals();
    expect(byRaw(ps, "ev-news")).toMatchObject({ status: "PENDING_REVIEW", target: { segtax: 7, id: "22" }, match_type: "broader" });
    expect(byRaw(ps, "ev-news").reason_codes).toContain("LOSSY_BROADER_MATCH");
    expect(byRaw(ps, "auto_sedans")).toMatchObject({ status: "APPROVED", target: { segtax: 7, id: "4" }, match_type: "exact", decided_by: "system:auto (exact match)" });
    expect(byRaw(ps, "ev_research")).toMatchObject({ status: "PENDING_REVIEW", target: { segtax: 4, id: "253" } });
    const intent = byRaw(ps, "ev_intent");
    expect(intent.status).toBe("PENDING_REVIEW");
    expect(intent.reason_codes).toEqual(expect.arrayContaining(["PROMOTION_REVIEW_REQUIRED"]));
    expect(intent.candidates.map((c: Json) => c.id)).toEqual(expect.arrayContaining(["824"]));
    expect(byRaw(ps, "hlth_diab")).toMatchObject({ status: "BLOCKED", reason_codes: ["SENSITIVE_CATEGORY"] });
    expect(byRaw(ps, "seg_4471")).toMatchObject({ status: "PENDING_REVIEW", target: null, reason_codes: ["NO_DICTIONARY_ENTRY", "ABSTAIN_INSUFFICIENT"] });
  });

  it("Idempotency-Key replays the same result and refuses a different body", async () => {
    const again = await importDictionary({ "idempotency-key": "import-1" });
    expect(again.status).toBe(200);
    expect((await body(again)).replayed).toBe(true);
    const diff = await importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: { ...(await as("ops.drivedesk")), "idempotency-key": "import-1" }, body: { entries: [] } }), P());
    expect([diff.status, (await body(diff)).code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
  });

  it("re-importing the same dictionary keeps existing proposals and decisions", async () => {
    const before = (await proposals()).length;
    const res = await importDictionary();
    expect((await body(res)).summary).toMatchObject({ proposals_created: 0, unchanged: 6 });
    expect((await proposals()).length).toBe(before);
  });
});

describe("review decisions (T11, T13, T20, concurrency)", () => {
  it("publisher_ops cannot decide (separation of duties)", async () => {
    const p = byRaw(await proposals(), "ev-news");
    const res = await decideAs("ops.drivedesk", p.id, { action: "approve", row_version: p.row_version });
    expect([res.status, (await body(res)).code]).toEqual([403, "FORBIDDEN_ROLE"]);
  });

  it("a reviewer of another publisher gets 404", async () => {
    const p = byRaw(await proposals(), "ev-news");
    const res = await decideAs("reviewer.metrodaily", p.id, { action: "approve", row_version: p.row_version });
    expect(res.status).toBe(404);
    // ...and cannot reach it through their own publisher's path either.
    const res2 = await decideAs("reviewer.metrodaily", p.id, { action: "approve", row_version: p.row_version }, "pub_metrodaily");
    expect([res2.status, (await body(res2)).code]).toEqual([404, "PROPOSAL_NOT_FOUND"]);
  });

  it("T13 sensitive blocks cannot be overridden, even by choosing a node directly", async () => {
    const p = byRaw(await proposals(), "hlth_diab");
    for (const b of [{ action: "approve" }, { action: "choose_other", target: { segtax: 4, id: "253" } }]) {
      const res = await decideAs("reviewer.drivedesk", p.id, { ...b, row_version: p.row_version });
      expect([res.status, (await body(res)).code]).toEqual([422, "SENSITIVE_OVERRIDE_FORBIDDEN"]);
    }
  });

  it("choosing a sensitive or out-of-branch node is refused", async () => {
    const p = byRaw(await proposals(), "seg_4471");
    const sens = await decideAs("reviewer.drivedesk", p.id, { action: "choose_other", target: { segtax: 7, id: "317" }, row_version: p.row_version });
    expect([sens.status, (await body(sens)).code]).toEqual([422, "SENSITIVE_OVERRIDE_FORBIDDEN"]);
    const wrong = await decideAs("reviewer.drivedesk", p.id, { action: "choose_other", target: { segtax: 4, id: "253" }, row_version: p.row_version });
    expect([wrong.status, (await body(wrong)).code]).toEqual([422, "CLASS_FIELD_MISMATCH"]);
    const fake = await decideAs("reviewer.drivedesk", p.id, { action: "choose_other", target: { segtax: 7, id: "99999" }, row_version: p.row_version });
    expect([fake.status, (await body(fake)).code]).toEqual([422, "INVALID_TAXONOMY_ID"]);
  });

  it("T11 intent from reading behaviour cannot be approved as intent; reviewer reclassifies to Interest 253", async () => {
    const p = byRaw(await proposals(), "ev_intent");
    const tryIntent = await decideAs("reviewer.drivedesk", p.id, { action: "choose_other", target: { segtax: 4, id: "824" }, row_version: p.row_version });
    expect([tryIntent.status, (await body(tryIntent)).code]).toEqual([422, "INTENT_SOURCE_REQUIRED"]);
    const ok = await decideAs("reviewer.drivedesk", p.id, { action: "choose_other", target: { segtax: 4, id: "253" }, reclassify_to: "AUDIENCE_INTEREST", note: "Reading behaviour is interest, not purchase intent", row_version: p.row_version });
    const b = await body(ok);
    expect(ok.status).toBe(200);
    expect(b.proposal).toMatchObject({ status: "APPROVED", signal_class: "AUDIENCE_INTEREST", target: { segtax: 4, id: "253" } });
    expect(b.proposal.reason_codes).toContain("PROMOTION_REJECTED");
  });

  it("concurrent decisions: exactly one wins, the other gets 409", async () => {
    const p = byRaw(await proposals(), "ev-news");
    const [a, b] = await Promise.all([
      decideAs("reviewer.drivedesk", p.id, { action: "approve", row_version: p.row_version }),
      decideAs("reviewer.drivedesk", p.id, { action: "abstain", row_version: p.row_version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const after = byRaw(await proposals(), "ev-news");
    if (after.status !== "APPROVED") {
      // The abstain won the race; re-run the approval path the demo needs.
      const fresh = await proposals("ABSTAINED");
      expect(byRaw(fresh, "ev-news").status).toBe("ABSTAINED");
      await prisma.proposal.update({ where: { id: after.id }, data: { status: "PENDING_REVIEW" } });
      const again = byRaw(await proposals(), "ev-news");
      expect((await decideAs("reviewer.drivedesk", again.id, { action: "approve", row_version: again.row_version })).status).toBe(200);
    }
    // A stale row_version is refused.
    const stale = await decideAs("reviewer.drivedesk", p.id, { action: "revoke", row_version: p.row_version });
    expect(stale.status).toBe(409);
  });

  it("approve ev_research (broader); deciding twice is 409", async () => {
    const p = byRaw(await proposals(), "ev_research");
    expect((await decideAs("reviewer.drivedesk", p.id, { action: "approve", row_version: p.row_version })).status).toBe(200);
    const again = await decideAs("reviewer.drivedesk", p.id, { action: "approve", row_version: p.row_version + 1 });
    expect([again.status, (await body(again)).code]).toEqual([409, "PROPOSAL_ALREADY_DECIDED"]);
  });

  it("malformed decision bodies are 400", async () => {
    const p = byRaw(await proposals(), "seg_4471");
    for (const b of [{}, { action: "nuke", row_version: 0 }, { action: "approve" }, { action: "approve", row_version: 0, extra: 1 }]) {
      expect((await decideAs("reviewer.drivedesk", p.id, b)).status).toBe(400);
    }
  });
});

describe("grants, versions and resolve (T08, T09, T14-T19, T22)", () => {
  it("only publisher_ops can set grants; reviewers cannot (separation of duties)", async () => {
    const g = { level: "G1", dsp_allowlist: ["ttd"], unmapped_handling: "drop" };
    const r1 = await grantPUT(req(`/v1/publishers/${PID}/grant`, { method: "PUT", headers: await as("reviewer.drivedesk"), body: g }), P());
    expect(r1.status).toBe(403);
    const bad = await grantPUT(req(`/v1/publishers/${PID}/grant`, { method: "PUT", headers: await as("ops.drivedesk"), body: { ...g, dsp_allowlist: [] } }), P());
    expect([bad.status, (await body(bad)).code]).toEqual([422, "GRANT_INCONSISTENT"]);
    const ok = await grantPUT(req(`/v1/publishers/${PID}/grant`, { method: "PUT", headers: await as("ops.drivedesk"), body: g }), P());
    expect((await body(ok)).grant).toMatchObject({ level: "G1", dsp_allowlist: ["ttd"], unmapped_handling: "drop", attested_by: "ops.drivedesk (publisher_ops)" });
    const read = await grantGET(req(`/v1/publishers/${PID}/grant`, { headers: await as("reviewer.drivedesk") }), P());
    expect((await body(read)).grant.level).toBe("G1");
  });

  it("onboarded but nothing published yet: proprietary IDs follow the unmapped setting", async () => {
    const r = await body(await resolve(nexonRequest("eu-consented")));
    expect(outcomes(r)["site.content.data[0].segment[0]:ev-news"]).toBe("REMOVED");
  });

  it("publish v1 (reviewer only); same content gives the same hash; activate", async () => {
    const ops = await versionsPOST(req(`/v1/publishers/${PID}/mapping-versions`, { method: "POST", headers: await as("ops.drivedesk") }), P());
    expect(ops.status).toBe(403);
    const v1 = await body(await versionsPOST(req(`/v1/publishers/${PID}/mapping-versions`, { method: "POST", headers: await as("reviewer.drivedesk") }), P()));
    expect(v1).toMatchObject({ version: 1, entries: 4 });
    expect(v1.diff.added.sort()).toEqual(["content|auto_sedans", "content|ev-news", "user|ev_intent", "user|ev_research"]);
    const act = await body(await activePUT(req(`/v1/publishers/${PID}/active-version`, { method: "PUT", headers: await as("reviewer.drivedesk"), body: { version: 1 } }), P()));
    expect(act).toMatchObject({ active_version: 1, changed: true });
  });

  it("T14 EU reader with consent: content 22 (segtax 7), audience 253 (segtax 4); sensitive, unknown and bad IDs removed", async () => {
    const r = await body(await resolve(nexonRequest("eu-consented")));
    expect(r).toMatchObject({ status: "OK", mapping_version: "pub_drivedesk@1", policy: { rule: "J2" } });
    const o = outcomes(r);
    expect(o).toMatchObject({
      "site.content.data[0].segment[0]:ev-news": "TRANSLATED->7/22",
      "site.content.data[0].segment[1]:seg_4471": "REMOVED",
      "user.data[0].segment[0]:ev_research": "TRANSLATED->4/253",
      "user.data[0].segment[1]:ev_intent": "TRANSLATED->4/253",
      "user.data[0].segment[2]:hlth_diab": "REMOVED",
      "user.data[1].segment[0]:253": "PASSED_THROUGH",
      "user.data[1].segment[1]:99999": "REMOVED",
    });
    const d = (raw: string) => (r.decisions as Json[]).find((x) => x.raw_id === raw)!;
    expect(d("ev-news").reason_codes).toEqual(["LOSSY_BROADER_MATCH", "TCF_ALLOWED"]);
    expect(d("seg_4471").reason_codes).toEqual(["NO_APPROVED_MAPPING", "UNMAPPED_DROP_PER_PUBLISHER"]);
    // T08: rewrite produces one new object per (provider, segtax); emptied originals are removed.
    expect(r.bid_request.site.content.data).toEqual([{ name: "drivedesk.example", ext: { segtax: 7 }, segment: [{ id: "22" }] }]);
    expect(r.bid_request.user.data).toEqual([
      { name: "metrodaily.example", ext: { segtax: 4 }, segment: [{ id: "253" }] },
      { name: "drivedesk.example", ext: { segtax: 4 }, segment: [{ id: "253" }] },
    ]);
    expect(r.bid_request.user.consent).toBe(nexonRequest("eu-consented").user.consent);
  });

  it("T15 EU reader without purposes 3/4: audience removed, content kept", async () => {
    const r = await body(await resolve(nexonRequest("eu-no-profiles")));
    const o = outcomes(r);
    expect(o["site.content.data[0].segment[0]:ev-news"]).toBe("TRANSLATED->7/22");
    expect(o["user.data[0].segment[0]:ev_research"]).toBe("REMOVED");
    expect(o["user.data[1].segment[0]:253"]).toBe("REMOVED");
    expect((r.decisions as Json[]).find((x) => x.raw_id === "253")!.reason_codes).toEqual(["VALID_STANDARD", "PURPOSE_CONSENT_MISSING", "PURPOSE_3"]);
    expect(r.bid_request.user.data).toBeUndefined();
  });

  it("T18 India reader: content kept, audience removed", async () => {
    const r = await body(await resolve(nexonRequest("india")));
    expect(outcomes(r)["site.content.data[0].segment[0]:ev-news"]).toBe("TRANSLATED->7/22");
    expect((r.decisions as Json[]).find((x) => x.raw_id === "ev_research")!.reason_codes).toContain("NO_SUPPORTED_CONSENT_FRAMEWORK");
  });

  it("T19 DSP not on the allowlist: translated signals removed, standard pass-through unaffected", async () => {
    const r = await body(await resolve(nexonRequest("eu-consented"), { dsp: "xandr" }));
    const o = outcomes(r);
    expect(o["site.content.data[0].segment[0]:ev-news"]).toBe("REMOVED");
    expect((r.decisions as Json[]).find((x) => x.raw_id === "ev-news")!.reason_codes).toEqual(["GRANT_NOT_ALLOWED_FOR_DSP"]);
    expect(o["user.data[1].segment[0]:253"]).toBe("PASSED_THROUGH");
  });

  it("T09 pass_raw keeps unmapped IDs in the original object and appends the translated one", async () => {
    await grantPUT(req(`/v1/publishers/${PID}/grant`, { method: "PUT", headers: await as("ops.drivedesk"), body: { level: "G1", dsp_allowlist: ["ttd"], unmapped_handling: "pass_raw" } }), P());
    const r = await body(await resolve(nexonRequest("eu-consented")));
    expect((r.decisions as Json[]).find((x) => x.raw_id === "hlth_diab")).toMatchObject({ outcome: "REMOVED", reason_codes: ["SENSITIVE_CATEGORY"] });
    expect(JSON.stringify(r.bid_request)).not.toContain("hlth_diab");
    expect(r.bid_request.site.content.data).toEqual([
      { name: "drivedesk.example", segment: [{ id: "seg_4471" }] },
      { name: "drivedesk.example", ext: { segtax: 7 }, segment: [{ id: "22" }] },
    ]);
    await grantPUT(req(`/v1/publishers/${PID}/grant`, { method: "PUT", headers: await as("ops.drivedesk"), body: { level: "G1", dsp_allowlist: ["ttd"], unmapped_handling: "drop" } }), P());
  });

  it("third-party proprietary data in a DriveDesk request is never translated with DriveDesk's mappings", async () => {
    const bid = nexonRequest("eu-consented");
    bid.site.content.data.push({ name: "othervendor.example", segment: [{ id: "ev-news" }] } as never);
    const r = await body(await resolve(bid));
    const d = (r.decisions as Json[]).find((x) => x.provider === "othervendor.example")!;
    expect(d.outcome).toBe("KEPT_RAW");
    expect(d.reason_codes).toContain("THIRD_PARTY_PROVIDER_NOT_TRANSLATED");
  });

  it("T22 rollback: publish v2 with a revoked mapping, output changes; activate v1, output returns exactly", async () => {
    const before = await body(await resolve(nexonRequest("eu-consented")));
    const p = byRaw(await proposals("APPROVED"), "ev-news");
    expect((await decideAs("reviewer.drivedesk", p.id, { action: "revoke", note: "bad edit for the demo", row_version: p.row_version })).status).toBe(200);
    const v2 = await body(await versionsPOST(req(`/v1/publishers/${PID}/mapping-versions`, { method: "POST", headers: await as("reviewer.drivedesk") }), P()));
    expect(v2).toMatchObject({ version: 2, diff: { removed: ["content|ev-news"] } });
    await activePUT(req(`/v1/publishers/${PID}/active-version`, { method: "PUT", headers: await as("reviewer.drivedesk"), body: { version: 2 } }), P());
    const during = await body(await resolve(nexonRequest("eu-consented")));
    expect(outcomes(during)["site.content.data[0].segment[0]:ev-news"]).toBe("REMOVED");
    const rb = await body(await activePUT(req(`/v1/publishers/${PID}/active-version`, { method: "PUT", headers: await as("reviewer.drivedesk"), body: { version: 1 } }), P()));
    expect(rb).toMatchObject({ active_version: 1, previous_version: 2 });
    const after = await body(await resolve(nexonRequest("eu-consented")));
    expect(after.bid_request).toEqual(before.bid_request);
    expect(after.decisions).toEqual(before.decisions);
    expect(after.snapshot_hash).toBe(before.snapshot_hash);
    // Activating the active version again is a no-op; unknown version is 404.
    expect((await body(await activePUT(req(`/v1/publishers/${PID}/active-version`, { method: "PUT", headers: await as("reviewer.drivedesk"), body: { version: 1 } }), P()))).changed).toBe(false);
    expect((await activePUT(req(`/v1/publishers/${PID}/active-version`, { method: "PUT", headers: await as("reviewer.drivedesk"), body: { version: 9 } }), P())).status).toBe(404);
  });

  it("identical approved mappings give an identical snapshot hash", async () => {
    // Re-approve ev-news so the approved set equals v1 again, then publish v3.
    const p = byRaw(await proposals("REVOKED"), "ev-news");
    await prisma.proposal.update({ where: { id: p.id }, data: { status: "PENDING_REVIEW" } });
    const again = byRaw(await proposals(), "ev-news");
    await decideAs("reviewer.drivedesk", again.id, { action: "approve", row_version: again.row_version });
    const list = await body(await versionsGET(req(`/v1/publishers/${PID}/mapping-versions`, { headers: await as("reviewer.drivedesk") }), P()));
    const v3 = await body(await versionsPOST(req(`/v1/publishers/${PID}/mapping-versions`, { method: "POST", headers: await as("reviewer.drivedesk") }), P()));
    expect(v3.snapshot_hash).toBe(list.versions.find((v: Json) => v.version === 1).snapshot_hash);
  });

  it("concurrent publishes never produce duplicate version numbers", async () => {
    const results = await Promise.all([1, 2, 3].map(async () => versionsPOST(req(`/v1/publishers/${PID}/mapping-versions`, { method: "POST", headers: await as("reviewer.drivedesk") }), P())));
    const ok = results.filter((r) => r.status === 201).length;
    const conflicts = results.filter((r) => r.status === 409).length;
    expect(ok + conflicts).toBe(3);
    const nums = (await prisma.mappingVersion.findMany({ where: { publisherId: PID } })).map((v) => v.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("T22 audit: actors, before/after and versions, and no user data", async () => {
    const res = await auditGET(req(`/v1/publishers/${PID}/audit`, { headers: await as("reviewer.drivedesk") }), P());
    const events = (await body(res)).events as Json[];
    const actions = new Set(events.map((e) => e.action));
    for (const a of ["import.created", "proposal.choose_other", "proposal.approve", "proposal.revoke", "grant.updated", "version.published", "version.activated", "version.rolled_back", "resolve.executed"]) {
      expect(actions, a).toContain(a);
    }
    const rb = events.find((e) => e.action === "version.rolled_back")!;
    expect(rb).toMatchObject({ actor: "reviewer.drivedesk (reviewer)", before: { active_version: 2 }, after: { active_version: 1 } });
    const dump = JSON.stringify(await prisma.auditEvent.findMany());
    expect(dump).not.toContain(nexonRequest("eu-consented").user.consent!);
    expect(dump).not.toContain("req-nexon-eu-consented");
    expect(dump).not.toContain("drivedesk.example/reviews");
    const other = await auditGET(req(`/v1/publishers/${PID}/audit`, { headers: await as("reviewer.metrodaily") }), P());
    expect(other.status).toBe(404);
  });
});

describe("resolve security and failure semantics (T20, T21)", () => {
  it("T20 a demo session cannot call /v1/resolve; the read-only key can; it cannot call control endpoints", async () => {
    const s = await resolvePOST(req("/v1/resolve", { method: "POST", headers: await as("admin"), body: { publisher_id: PID, dsp: "ttd", bid_request: nexonRequest("india") } }), undefined);
    expect(s.status).toBe(403);
    const ro = await resolve(nexonRequest("india"), { key: READONLY });
    expect(ro.status).toBe(200);
    const imp = await importPOST(req(`/v1/publishers/${PID}/imports`, { method: "POST", headers: { authorization: `Bearer ${BIDDER}` }, body: { entries: [] } }), P());
    expect(imp.status).toBe(403);
    const pr = await proposalsGET(req(`/v1/publishers/${PID}/proposals`, { headers: { authorization: `Bearer ${READONLY}` } }), P());
    expect(pr.status).toBe(403);
    const none = await resolvePOST(req("/v1/resolve", { method: "POST", body: { publisher_id: PID, dsp: "ttd", bid_request: nexonRequest("india") } }), undefined);
    expect(none.status).toBe(401);
  });

  it("the read-only key is rate limited (60 per minute)", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 62; i++) codes.push((await resolve({ id: "x", imp: [{}] }, { key: READONLY })).status);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });

  it("an unknown publisher is treated as not onboarded, not an error", async () => {
    const r = await body(await resolve(nexonRequest("eu-consented"), { publisher_id: "pub_unknown" }));
    expect(r.status).toBe("OK");
    expect((r.decisions as Json[]).find((x) => x.raw_id === "ev-news")!.reason_codes).toContain("PUBLISHER_NOT_ONBOARDED");
  });

  it("T21 envelope errors: 400 and 413", async () => {
    const bad = await resolvePOST(req("/v1/resolve", { method: "POST", headers: { authorization: `Bearer ${BIDDER}` }, body: { publisher_id: PID, dsp: "ttd", bid_request: { imp: [] } } }), undefined);
    expect([bad.status, (await body(bad)).code]).toEqual([400, "SCHEMA_VIOLATION"]);
    const big = await resolvePOST(req("/v1/resolve", { method: "POST", headers: { authorization: `Bearer ${BIDDER}` }, body: { publisher_id: PID, dsp: "ttd", bid_request: { id: "a", imp: [{}], pad: "x".repeat(70_000) } } }), undefined);
    expect(big.status).toBe(413);
  });

  it("T21 snapshot store unavailable -> 503 SNAPSHOT_UNAVAILABLE", async () => {
    const spy = vi.spyOn((await import("@/lib/db/client")).prisma.publisher, "findFirst").mockRejectedValueOnce(new Error("db down"));
    const res = await resolve(nexonRequest("eu-consented"));
    expect([res.status, (await body(res)).code, res.headers.get("retry-after")]).toEqual([503, "SNAPSHOT_UNAVAILABLE", "30"]);
    spy.mockRestore();
  });

  it("the lab route runs resolve server-side for any persona, without exposing the key", async () => {
    const res = await labResolvePOST(req("/api/lab/resolve", { method: "POST", headers: await as("curator.select"), body: { publisher_id: PID, dsp: "ttd", bid_request: nexonRequest("eu-consented") } }), undefined);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(BIDDER);
    expect(JSON.parse(text).status).toBe("OK");
  });

  it("demo reset wipes and re-seeds the demo tenant", async () => {
    const res = await resetPOST(req("/v1/demo/reset", { method: "POST", headers: await as("admin") }), undefined);
    expect(res.status).toBe(200);
    expect(await prisma.proposal.count({ where: { publisherId: PID } })).toBe(0);
    expect((await prisma.grant.findUnique({ where: { publisherId: PID } }))!.level).toBe("G0");
  });
});
