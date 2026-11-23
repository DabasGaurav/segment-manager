import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSignals } from "@/lib/openrtb/detect";
import { loadRegistry } from "@/lib/taxonomy/registry";
import { bidRequest, contentData } from "./fixtures";

const reg = loadRegistry(path.join(process.cwd(), "data", "iab"));
const detect = (req: Record<string, unknown>) => detectSignals(reg, req);

describe("T03 valid standard signals pass through per segment", () => {
  const req = bidRequest({
    user: { data: [{ id: "md", name: "metrodaily.example", cids: ["c1"], ext: { segtax: 4, foo: 1 }, segment: [{ id: "253" }, { id: "99999" }] }] },
  });
  const r = detect(req);
  const obj = r.data_objects[0]!;

  it("keeps the object and validates each segment against Audience 1.1", () => {
    expect(obj).toMatchObject({ path: "user.data[0]", segtax: 4, provider_name: "metrodaily.example", next_step: "EVALUATE_SEGMENTS" });
    expect(obj.segments[0]).toMatchObject({
      raw_id: "253",
      status: "VALID_STANDARD",
      next_step: "PASS_THROUGH_SUBJECT_TO_POLICY",
      signal_class: "AUDIENCE_INTEREST",
      reason_codes: ["VALID_STANDARD"],
    });
    expect(obj.segments[0]!.node).toMatchObject({ taxonomy: "audience/1.1", id: "253", name: "Green Vehicles" });
  });

  it("removes only the unknown ID, with SEGTAX_ID_NOT_IN_TAXONOMY", () => {
    expect(obj.segments[1]).toMatchObject({ raw_id: "99999", next_step: "REMOVE", reason_codes: ["SEGTAX_ID_NOT_IN_TAXONOMY"] });
  });

  it("never mutates the input", () => {
    const copy = JSON.parse(JSON.stringify(req));
    detect(req);
    expect(req).toEqual(copy);
  });

  it("classifies Purchase Intent* and Demographic nodes by their official tier 1", () => {
    const r2 = detect(bidRequest({ user: { data: [{ name: "x", ext: { segtax: 4 }, segment: [{ id: "824" }, { id: "3" }] }] } }));
    expect(r2.data_objects[0]!.segments.map((s) => s.signal_class)).toEqual(["PURCHASE_INTENT", "DEMOGRAPHIC"]);
  });

  it("validates content IDs against the matching version: 6, 7 and 9 all accepted", () => {
    for (const segtax of [6, 7, 9]) {
      const r3 = detect(bidRequest({ site: contentData([{ name: "x", ext: { segtax }, segment: [{ id: "22" }] }]) }));
      expect(r3.data_objects[0]!.segments[0]).toMatchObject({ status: "VALID_STANDARD", signal_class: "CONTENT_TOPIC" });
    }
    // An ID that exists only in 2.2 is rejected under segtax 7.
    const only22 = [...reg.byKey.get("content/2.2")!.nodes.keys()].find((id) => !reg.byKey.get("content/3.0")!.nodes.has(id))!;
    const r4 = detect(bidRequest({ site: contentData([{ name: "x", ext: { segtax: 7 }, segment: [{ id: only22 }] }]) }));
    expect(r4.data_objects[0]!.segments[0]!.reason_codes).toEqual(["SEGTAX_ID_NOT_IN_TAXONOMY"]);
  });

  it("reads app.content.data and dooh.content.data too", () => {
    const r5 = detect({ id: "a", imp: [{}], app: { content: { data: [{ name: "x", ext: { segtax: 7 }, segment: [{ id: "22" }] }] } }, dooh: { content: { data: [{ name: "y", segment: [{ id: "p1" }] }] } } });
    expect(r5.data_objects.map((o) => o.path)).toEqual(["app.content.data[0]", "dooh.content.data[0]"]);
  });
});

describe("T04 misplaced taxonomies remove the whole Data object", () => {
  it("segtax 4 inside site.content.data", () => {
    const r = detect(bidRequest({ site: contentData([{ name: "x", ext: { segtax: 4 }, segment: [{ id: "253" }] }]) }));
    expect(r.data_objects[0]).toMatchObject({ next_step: "REMOVE_OBJECT", reason_codes: ["MISPLACED_TAXONOMY"] });
    expect(r.data_objects[0]!.segments[0]).toMatchObject({ next_step: "REMOVE", reason_codes: ["MISPLACED_TAXONOMY"] });
  });
  it("content segtax inside user.data", () => {
    const r = detect(bidRequest({ user: { data: [{ name: "x", ext: { segtax: 7 }, segment: [{ id: "22" }] }] } }));
    expect(r.data_objects[0]!.reason_codes).toEqual(["MISPLACED_TAXONOMY"]);
  });
  it("Ad Product taxonomies (3, 8) anywhere, and Content 2.1 (5) in user.data", () => {
    for (const [where, segtax] of [["site", 3], ["user", 8], ["user", 5]] as const) {
      const d = [{ name: "x", ext: { segtax }, segment: [{ id: "1" }] }];
      const r = detect(where === "site" ? bidRequest({ site: contentData(d) }) : bidRequest({ user: { data: d } }));
      expect(r.data_objects[0]!.reason_codes).toEqual(["MISPLACED_TAXONOMY"]);
    }
  });
});

describe("T05 deprecated and invalid segtax values", () => {
  const one = (segtax: unknown) =>
    detect(bidRequest({ site: contentData([{ name: "x", ext: { segtax }, segment: [{ id: "22" }] }]) })).data_objects[0]!;
  it("segtax 1 and 2 are DEPRECATED_SEGTAX", () => {
    expect(one(1).reason_codes).toEqual(["DEPRECATED_SEGTAX"]);
    expect(one(2).reason_codes).toEqual(["DEPRECATED_SEGTAX"]);
  });
  it.each([["7"], [42], [0], [-7], [7.5], [null], [true], [[7]], [{}], [10], [499], [1e300], [Number.MAX_SAFE_INTEGER + 2]])(
    "segtax %j is SEGTAX_INVALID_VALUE and removed",
    (v) => {
      const o = one(v);
      expect(o.next_step).toBe("REMOVE_OBJECT");
      expect(o.reason_codes).toEqual(["SEGTAX_INVALID_VALUE"]);
    },
  );
  it("segtax 5 (Content 2.1) passes through with a warning because its file is not loaded", () => {
    const o = one(5);
    expect(o.reason_codes).toEqual(["UNVALIDATED_STANDARD_SEGTAX"]);
    expect(o.warnings).toContain("TAXONOMY_FILE_NOT_LOADED");
    expect(o.segments[0]!.next_step).toBe("PASS_THROUGH_SUBJECT_TO_POLICY");
  });
});

describe("T06 vendor taxonomies", () => {
  it("segtax 512 in user.data passes through, never translated, class left to policy", () => {
    const r = detect(bidRequest({ user: { data: [{ name: "vendor.example", ext: { segtax: 512 }, segment: [{ id: "abc" }] }] } }));
    expect(r.data_objects[0]!.segments[0]).toMatchObject({ status: "VENDOR", next_step: "PASS_THROUGH_SUBJECT_TO_POLICY", signal_class: null, reason_codes: ["VENDOR_SEGTAX"] });
  });
});

describe("T07 segtax in a non-standard place means proprietary", () => {
  it("segtax inside Segment.ext", () => {
    const r = detect(bidRequest({ site: contentData([{ name: "drivedesk.example", segment: [{ id: "22", ext: { segtax: 7 } }] }]) }));
    const o = r.data_objects[0]!;
    expect(o.reason_codes).toEqual(["PROPRIETARY_NO_SEGTAX"]);
    expect(o.warnings).toContain("SEGTAX_NONSTANDARD_LOCATION");
    expect(o.segments[0]).toMatchObject({ status: "PROPRIETARY", next_step: "TRANSLATION_CANDIDATE" });
  });
  it("segtax as a top-level Data field", () => {
    const r = detect(bidRequest({ site: contentData([{ name: "x", segtax: 7, segment: [{ id: "22" }] }]) }));
    expect(r.data_objects[0]!.warnings).toContain("SEGTAX_NONSTANDARD_LOCATION");
  });
  it("an ID that happens to look like IAB is still proprietary without segtax", () => {
    const r = detect(bidRequest({ user: { data: [{ name: "x", segment: [{ id: "253" }] }] } }));
    expect(r.data_objects[0]!.segments[0]!.status).toBe("PROPRIETARY");
  });
});

describe("Adversarial and malformed input", () => {
  it("non-object Data entries, non-array segment, empty segment list", () => {
    const r = detect(bidRequest({ site: contentData([null, "x", 5, [], { name: "a", segment: "22" }, { name: "b", segment: [] }, { name: "c" }]) }));
    expect(r.data_objects.map((o) => o.reason_codes[0])).toEqual([
      "MALFORMED_DATA_OBJECT", "MALFORMED_DATA_OBJECT", "MALFORMED_DATA_OBJECT", "MALFORMED_DATA_OBJECT",
      "MALFORMED_DATA_OBJECT", "EMPTY_DATA_OBJECT", "EMPTY_DATA_OBJECT",
    ]);
    expect(r.data_objects.every((o) => o.next_step === "REMOVE_OBJECT")).toBe(true);
  });
  it("data that is not an array is reported at location level", () => {
    const r = detect(bidRequest({ user: { data: { segment: [] } } }));
    expect(r.location_errors).toEqual([{ path: "user.data", reason_codes: ["MALFORMED_DATA_OBJECT"] }]);
  });
  it("bad segment IDs are removed one by one, never the whole valid object", () => {
    const long = "x".repeat(257);
    const r = detect(bidRequest({ user: { data: [{ name: "m", ext: { segtax: 4 }, segment: [{ id: 253 }, { id: "" }, {}, null, { id: long }, { id: "253" }] }] } }));
    const segs = r.data_objects[0]!.segments;
    expect(segs.slice(0, 5).every((s) => s.reason_codes[0] === "MALFORMED_SEGMENT" && s.next_step === "REMOVE")).toBe(true);
    expect(segs[4]!.raw_id!.length).toBe(256);
    expect(segs[5]!.status).toBe("VALID_STANDARD");
  });
  it("IDs are matched exactly: no trimming, no case folding, no leading zeros", () => {
    const r = detect(bidRequest({ site: contentData([{ name: "x", ext: { segtax: 9 }, segment: [{ id: " 22" }, { id: "022" }, { id: "80dv8o" }, { id: "80DV8O" }] }]) }));
    expect(r.data_objects[0]!.segments.map((s) => s.status)).toEqual(["INVALID", "INVALID", "INVALID", "VALID_STANDARD"]);
  });
  it("prototype keys are ordinary data, not lookups", () => {
    const req = JSON.parse('{"id":"a","imp":[{}],"user":{"data":[{"name":"x","ext":{"segtax":4},"segment":[{"id":"__proto__"},{"id":"constructor"},{"id":"toString"}]}]}}');
    const r = detect(req);
    expect(r.data_objects[0]!.segments.every((s) => s.reason_codes[0] === "SEGTAX_ID_NOT_IN_TAXONOMY")).toBe(true);
    const req2 = JSON.parse('{"id":"a","imp":[{}],"user":{"__proto__":{"data":[{"segment":[{"id":"1"}]}]}}}');
    expect(detect(req2).data_objects).toEqual([]);
  });
  it("a segtax inherited through the prototype chain is not honoured", () => {
    const ext = Object.create({ segtax: 4 });
    const r = detect(bidRequest({ user: { data: [{ name: "x", ext, segment: [{ id: "253" }] }] } }));
    expect(r.data_objects[0]!.reason_codes).toEqual(["PROPRIETARY_NO_SEGTAX"]);
  });
  it("duplicate standard IDs are flagged", () => {
    const r = detect(bidRequest({ user: { data: [{ name: "x", ext: { segtax: 4 }, segment: [{ id: "253" }, { id: "253" }] }] } }));
    expect(r.data_objects[0]!.segments[1]!.reason_codes).toContain("DUPLICATE_SEGMENT");
  });
  it("proprietary segments carrying value are flagged for abstention", () => {
    const r = detect(bidRequest({ user: { data: [{ name: "x", segment: [{ id: "ev_score", value: "0.9" }] }] } }));
    expect(r.data_objects[0]!.segments[0]!.reason_codes).toEqual(["PROPRIETARY_NO_SEGTAX", "SEGMENT_HAS_VALUE"]);
  });
  it("missing provider name is a warning, not a removal", () => {
    const r = detect(bidRequest({ user: { data: [{ ext: { segtax: 4 }, segment: [{ id: "253" }] }] } }));
    expect(r.data_objects[0]!.warnings).toContain("MISSING_PROVIDER_NAME");
    expect(r.data_objects[0]!.segments[0]!.status).toBe("VALID_STANDARD");
  });
  it("a provider sending segtax 6 and 7 in separate objects is allowed and reported as info", () => {
    const r = detect(bidRequest({ site: contentData([{ name: "p", ext: { segtax: 6 }, segment: [{ id: "22" }] }, { name: "p", ext: { segtax: 7 }, segment: [{ id: "22" }] }]) }));
    expect(r.info.map((i) => i.code)).toEqual(["MULTIPLE_CONTENT_VERSIONS"]);
    expect(r.data_objects.every((o) => o.next_step === "EVALUATE_SEGMENTS")).toBe(true);
  });
  it("every segment gets exactly one next step and at least one reason code", () => {
    const r = detect(bidRequest({
      site: contentData([{ name: "a", ext: { segtax: 2 }, segment: [{ id: "1" }] }, { name: "b", segment: [{ id: "q" }, 7] }]),
      user: { data: [{ name: "c", ext: { segtax: 4 }, segment: [{ id: "253" }, { id: "nope" }] }] },
    }));
    for (const s of r.data_objects.flatMap((o) => o.segments)) {
      expect(["PASS_THROUGH_SUBJECT_TO_POLICY", "TRANSLATION_CANDIDATE", "REMOVE"]).toContain(s.next_step);
      expect(s.reason_codes.length).toBeGreaterThan(0);
    }
    expect(r.summary).toEqual({ data_objects: 3, segments: 5, valid_standard: 1, proprietary: 1, removed: 3, other_pass_through: 0 });
  });
});
