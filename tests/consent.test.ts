import { describe, expect, it } from "vitest";
import { evaluatePolicy, decodeTcString, evaluateTcf, type GvlInfo } from "@/lib/policy/consent";
import { buildTcString } from "@/lib/policy/tcf-builder";

const GVL: GvlInfo = { source: "test", vendorListVersion: null, vendor: { id: 142, name: "t", purposes: [1, 2, 3, 4, 7], legIntPurposes: [], flexiblePurposes: [] } };
const req = (consent: unknown, regs: Record<string, unknown> = { gdpr: 1 }, country: string | undefined = "DEU") => ({
  id: "r", imp: [{}], user: { consent }, regs, ...(country ? { device: { geo: { country } } } : {}),
});
const run = (consent: unknown, regs?: Record<string, unknown>, country?: string) => evaluatePolicy(req(consent, regs, country), GVL);

describe("T14-T17 TCF evaluator (illustrative, fail closed)", () => {
  it("T14 vendor 142 + purposes 1-4 consented: content and audience allowed", () => {
    const r = run(buildTcString());
    expect(r.rule).toBe("J2");
    expect(r.content).toEqual({ allowed: true, codes: ["TCF_ALLOWED"] });
    expect(r.audience).toEqual({ allowed: true, codes: ["TCF_ALLOWED"] });
  });
  it("T15 without purposes 3 and 4: audience denied, content allowed", () => {
    const r = run(buildTcString({ purposeConsents: [1, 2] }));
    expect(r.content.allowed).toBe(true);
    expect(r.audience).toEqual({ allowed: false, codes: ["PURPOSE_CONSENT_MISSING", "PURPOSE_3"] });
  });
  it("T16 publisher restriction type 0 on purpose 2: content denied", () => {
    const r = run(buildTcString({ restrictions: [{ purpose: 2, type: 0 }] }));
    expect(r.content.codes).toEqual(["PUB_RESTRICTION_NOT_ALLOWED", "PURPOSE_2"]);
    expect(r.audience.allowed).toBe(true);
  });
  it("T17 malformed string, IsServiceSpecific=0, vendor not disclosed", () => {
    for (const bad of ["garbage!!", "CQ", "BOEFEAyOEFEAyAHABDENAI4AAAB9vABAASA", 42, { a: 1 }, "x".repeat(9000)]) {
      const r = run(bad);
      expect(r.content.allowed, String(bad).slice(0, 20)).toBe(false);
      expect(r.audience.allowed).toBe(false);
      expect(r.content.codes[0]).toBe("TCF_STRING_INVALID");
    }
    expect(run(buildTcString({ serviceSpecific: false })).content.codes).toEqual(["TCF_NOT_SERVICE_SPECIFIC"]);
    expect(run(buildTcString({ disclosed: "other-only" })).audience.codes).toEqual(["VENDOR_NOT_DISCLOSED"]);
  });
  it("missing string under GDPR is denied", () => {
    expect(run(undefined).content.codes).toEqual(["TCF_STRING_MISSING"]);
    expect(run("").audience.codes).toEqual(["TCF_STRING_MISSING"]);
  });
  it("vendor consent missing", () => {
    expect(run(buildTcString({ vendorConsent: false })).content.codes).toEqual(["VENDOR_CONSENT_MISSING"]);
  });
  it("legacy string without Disclosed Vendors: allowed with a warning", () => {
    const r = run(buildTcString({ disclosed: false }));
    expect(r.content.allowed).toBe(true);
    expect(r.warnings).toContain("LEGACY_STRING_NO_DISCLOSED_VENDORS");
  });
  it("PurposeOneTreatment=1 is unsupported for audience (needs purpose 1)", () => {
    const r = run(buildTcString({ purposeOneTreatment: true }));
    expect(r.audience.codes).toEqual(["P1_TREATMENT_UNSUPPORTED"]);
    expect(r.content.allowed).toBe(true);
  });
  it("vendor that did not declare a purpose is denied for it", () => {
    const g: GvlInfo = { ...GVL, vendor: { ...GVL.vendor, purposes: [1, 3, 4] } };
    expect(evaluatePolicy(req(buildTcString()), g).content.codes).toEqual(["VENDOR_PURPOSE_NOT_DECLARED", "PURPOSE_2"]);
  });
  it("LI basis: allowed for purpose 2 with LI signals; never for 3/4; restriction types 1/2 respect flexibility", () => {
    const li: GvlInfo = { ...GVL, vendor: { ...GVL.vendor, purposes: [1], legIntPurposes: [2, 3, 4], flexiblePurposes: [2] } };
    const s = buildTcString({ purposeConsents: [1], purposeLI: [2, 3, 4] });
    const r = evaluatePolicy(req(s), li);
    expect(r.content).toEqual({ allowed: true, codes: ["TCF_ALLOWED"] });
    expect(r.audience.codes).toEqual(["LI_NOT_PERMITTED_FOR_PURPOSE", "PURPOSE_3"]);
    // Require consent on flexible purpose 2: switches to consent, which is missing.
    const r2 = evaluatePolicy(req(buildTcString({ purposeConsents: [1], purposeLI: [2], restrictions: [{ purpose: 2, type: 1 }] })), li);
    expect(r2.content.codes).toEqual(["PURPOSE_CONSENT_MISSING", "PURPOSE_2"]);
    // Require LI on a consent-only, non-flexible purpose: unsatisfiable.
    const r3 = evaluatePolicy(req(buildTcString({ restrictions: [{ purpose: 2, type: 2 }], encoderVendor: { purposes: [1, 2, 3, 4], legIntPurposes: [], flexiblePurposes: [2] } })), GVL);
    expect(r3.content.codes).toEqual(["PUB_RESTRICTION_UNSATISFIABLE", "PURPOSE_2"]);
    // LI basis but no LI transparency signal.
    const r4 = evaluatePolicy(req(buildTcString({ purposeConsents: [1], purposeLI: [] })), li);
    expect(r4.content.codes).toEqual(["PURPOSE_LI_NOT_ESTABLISHED", "PURPOSE_2"]);
  });
  it("decodeTcString never throws", () => {
    for (const v of [null, undefined, "", ".", "C", "C.", "C!!", "Cx".repeat(100)]) expect(() => decodeTcString(v)).not.toThrow();
  });
  it("evaluateTcf rejects a string where 142 is absent from Disclosed Vendors even if consented", () => {
    const d = decodeTcString(buildTcString({ disclosed: "other-only" }));
    if ("error" in d) throw new Error("decode");
    expect(evaluateTcf(d.model, [2], GVL, []).codes).toEqual(["VENDOR_NOT_DISCLOSED"]);
  });
});

describe("T18 jurisdiction routing (illustrative pack)", () => {
  it("India, gdpr 0: content allowed, audience denied (no machine-readable DPDP consent signal)", () => {
    const r = run(undefined, { gdpr: 0 }, "IND");
    expect([r.rule, r.content.allowed, r.audience.codes]).toEqual(["J3", true, ["NO_SUPPORTED_CONSENT_FRAMEWORK"]]);
  });
  it("COPPA blocks audience everywhere, content follows its own rule", () => {
    const r = run(buildTcString(), { gdpr: 1, coppa: 1 });
    expect(r.audience.codes).toEqual(["CHILD_DIRECTED_BLOCK"]);
    expect(r.content.allowed).toBe(true);
    expect(run(undefined, { gdpr: 0, coppa: 1 }, "IND").audience.codes).toEqual(["CHILD_DIRECTED_BLOCK"]);
  });
  it("unknown jurisdiction denies everything", () => {
    for (const [regs, c] of [[{}, undefined], [{ gdpr: 0 }, undefined], [{}, "IND"], [{ gdpr: "1" }, "DEU"], [{ gdpr: 2 }, "DEU"]] as const) {
      const r = run(undefined, regs as Record<string, unknown>, c);
      expect(r.content.allowed).toBe(false);
      expect(r.audience.allowed).toBe(false);
    }
  });
  it("gdpr omitted but an EEA country: TCF applies", () => {
    expect(run(buildTcString(), {}, "FRA").rule).toBe("J2");
    expect(run(undefined, {}, "FRA").content.codes).toEqual(["TCF_STRING_MISSING"]);
  });
  it("USA: content allowed, audience denied until GPP is built", () => {
    expect(run(undefined, { gdpr: 0 }, "USA").audience.codes).toEqual(["GPP_NOT_SUPPORTED"]);
  });
  it("other configured-nowhere country: both denied", () => {
    expect(run(undefined, { gdpr: 0 }, "BRA").content.codes).toEqual(["JURISDICTION_NOT_CONFIGURED"]);
  });
  it("lower-case or alpha-2 country codes are not trusted", () => {
    const r = run(undefined, {}, "de");
    expect(r.rule).toBe("J6");
    expect(r.warnings).toContain("COUNTRY_NOT_ISO3");
  });
});
