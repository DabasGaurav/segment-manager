import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, parseEnvelope } from "@/lib/openrtb/envelope";
import { bidRequest } from "./fixtures";

const env = (bid: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ publisher_id: "pub_drivedesk", dsp: "ttd", bid_request: bid, ...extra });

describe("envelope validation (Phase 3.1 §A3.2)", () => {
  it("accepts a valid OpenRTB 2.6 request and keeps unknown fields exactly", () => {
    const bid = { ...bidRequest(), ext: { prebid: { x: [1, 2] } }, source: { schain: { ver: "1.0" } } };
    const r = parseEnvelope(env(bid));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.bid_request).toEqual(bid);
  });
  it.each([
    ["not JSON", "{", "INVALID_JSON"],
    ["array body", "[]", "SCHEMA_VIOLATION"],
    ["missing bid_request.id", env({ imp: [{}] }), "SCHEMA_VIOLATION"],
    ["empty imp", env({ id: "a", imp: [] }), "SCHEMA_VIOLATION"],
    ["bid_request not object", env("x"), "SCHEMA_VIOLATION"],
    ["bad publisher id", JSON.stringify({ publisher_id: "../../etc", dsp: "ttd", bid_request: bidRequest() }), "SCHEMA_VIOLATION"],
    ["bad dsp", JSON.stringify({ publisher_id: "pub_drivedesk", dsp: "TTD; drop", bid_request: bidRequest() }), "SCHEMA_VIOLATION"],
  ])("rejects %s with 400", (_n, body, code) => {
    const r = parseEnvelope(body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe(code);
    }
  });
  it("names the failing field paths", () => {
    const r = parseEnvelope(env({ imp: [] }));
    if (r.ok) throw new Error("expected failure");
    expect(r.errors!.map((e) => e.path).sort()).toEqual(["bid_request.id", "bid_request.imp"]);
  });
  it("413 above 64 KB, measured in UTF-8 bytes", () => {
    const pad = "€".repeat(Math.ceil(MAX_BODY_BYTES / 3) + 10); // 3 bytes each
    const r = parseEnvelope(env({ ...bidRequest(), ext: { pad } }));
    expect(r.ok === false && r.status === 413 && r.code === "PAYLOAD_TOO_LARGE").toBe(true);
  });
  it("422 TOO_MANY_SIGNALS above 50 Data objects or 500 segments", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `p${i}`, segment: [{ id: "a" }] }));
    const r1 = parseEnvelope(env(bidRequest({ user: { data: many } })));
    expect(r1.ok === false && r1.status === 422 && r1.code === "TOO_MANY_SIGNALS").toBe(true);
    const segs = Array.from({ length: 501 }, (_, i) => ({ id: `s${i}` }));
    const r2 = parseEnvelope(env(bidRequest({ user: { data: [{ name: "p", segment: segs }] } })));
    expect(r2.ok === false && r2.code === "TOO_MANY_SIGNALS").toBe(true);
    const r3 = parseEnvelope(env(bidRequest({ user: { data: [{ name: "p", segment: segs.slice(0, 500) }] } })));
    expect(r3.ok).toBe(true);
  });
});
