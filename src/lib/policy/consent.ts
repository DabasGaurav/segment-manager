/**
 * Consent and jurisdiction policy (Phase 3.1 §A4). ILLUSTRATIVE: built from the IAB TCF v2 technical
 * specification ("Consent string and vendor list formats"); it is not legal advice and makes no claim
 * of compliance. Media.net legal would own the real policy pack. Every unsupported or unknown case
 * fails closed (DENY).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { TCString, type TCModel } from "@iabtechlabtcf/core";

export const POLICY_PACK_VERSION = "illustrative-2026-11-23";
export const VENDOR_ID = 142; // Media.net's IAB GVL vendor ID

export const PURPOSES_FOR = { content: [2], audience: [1, 3, 4] } as const;
const LI_FORBIDDEN = new Set([1, 3, 4, 5, 6]); // TCF 2.2 removed LI for 3-6; Purpose 1 is consent-only

/** EEA + UK + Switzerland, ISO-3166-1 alpha-3 (OpenRTB device.geo.country). */
export const GDPR_COUNTRIES = new Set([
  "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU",
  "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE", "ISL", "LIE", "NOR", "GBR", "CHE",
]);

export interface VendorDecl {
  id: number;
  name: string;
  purposes: number[];
  legIntPurposes: number[];
  flexiblePurposes: number[];
}
export interface GvlInfo {
  source: string; // "gvl:v<version>" or "fixture:illustrative"
  vendorListVersion: number | null;
  vendor: VendorDecl;
}

let gvlCache: GvlInfo | null = null;
export function loadGvl(): GvlInfo {
  if (gvlCache) return gvlCache;
  const dir = path.join(/* turbopackIgnore: true */ process.cwd(), "data", "gvl");
  const live = path.join(/* turbopackIgnore: true */ dir, "vendor-142.live.json");
  const file = existsSync(live) ? live : path.join(/* turbopackIgnore: true */ dir, "vendor-142.fixture.json");
  const j = JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8"));
  gvlCache = { source: j.source, vendorListVersion: j.vendorListVersion ?? null, vendor: j.vendor };
  return gvlCache;
}
export function __setGvlForTests(g: GvlInfo | null) {
  gvlCache = g;
}

export interface Verdict {
  allowed: boolean;
  codes: string[];
}
export interface PolicyResult {
  jurisdiction: string; // e.g. "GDPR (regs.gdpr=1)", "IND", "UNKNOWN"
  rule: string; // J1..J6
  content: Verdict;
  audience: Verdict;
  warnings: string[];
}

const allow = (code: string): Verdict => ({ allowed: true, codes: [code] });
const deny = (...codes: string[]): Verdict => ({ allowed: false, codes });

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);

/** Decode user.consent. Returns a model or a DENY code. Never throws for bad input. */
export function decodeTcString(raw: unknown): { model: TCModel } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { error: "TCF_STRING_MISSING" };
  if (typeof raw !== "string" || raw.length > 8192) return { error: "TCF_STRING_INVALID" };
  const core = raw.split(".")[0] ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(core) || core[0] !== "C") return { error: "TCF_STRING_INVALID" }; // core segment, TCF v2
  try {
    const model = TCString.decode(raw);
    if (model.version !== 2) return { error: "TCF_STRING_INVALID" };
    return { model };
  } catch {
    return { error: "TCF_STRING_INVALID" };
  }
}

/** A4.2: may vendor 142 process for every purpose in `required`? */
export function evaluateTcf(model: TCModel, required: readonly number[], gvl: GvlInfo, warnings: string[]): Verdict {
  if (!model.isServiceSpecific) return deny("TCF_NOT_SERVICE_SPECIFIC");
  if (model.vendorsDisclosed.size > 0) {
    if (!model.vendorsDisclosed.has(VENDOR_ID)) return deny("VENDOR_NOT_DISCLOSED");
  } else if (!warnings.includes("LEGACY_STRING_NO_DISCLOSED_VENDORS")) {
    warnings.push("LEGACY_STRING_NO_DISCLOSED_VENDORS");
  }
  if (gvl.vendorListVersion !== null && model.vendorListVersion !== gvl.vendorListVersion && !warnings.includes("GVL_VERSION_MISMATCH")) {
    warnings.push("GVL_VERSION_MISMATCH");
  }
  const v = gvl.vendor;
  const restrictions = model.publisherRestrictions.getRestrictions(VENDOR_ID);
  for (const p of required) {
    if (p === 1 && model.purposeOneTreatment) return deny("P1_TREATMENT_UNSUPPORTED");
    let basis: "consent" | "li";
    if (v.purposes.includes(p)) basis = "consent";
    else if (v.legIntPurposes.includes(p)) basis = "li";
    else return deny("VENDOR_PURPOSE_NOT_DECLARED", `PURPOSE_${p}`);

    for (const r of restrictions.filter((x) => x.purposeId === p)) {
      if (r.restrictionType === 0) return deny("PUB_RESTRICTION_NOT_ALLOWED", `PURPOSE_${p}`);
      if (r.restrictionType === 1) {
        if (!v.flexiblePurposes.includes(p) && basis !== "consent") return deny("PUB_RESTRICTION_UNSATISFIABLE", `PURPOSE_${p}`);
        basis = "consent";
      } else if (r.restrictionType === 2) {
        if (!v.flexiblePurposes.includes(p) && basis !== "li") return deny("PUB_RESTRICTION_UNSATISFIABLE", `PURPOSE_${p}`);
        basis = "li";
      } else {
        return deny("PUB_RESTRICTION_UNDEFINED", `PURPOSE_${p}`);
      }
    }
    if (basis === "li" && LI_FORBIDDEN.has(p)) return deny("LI_NOT_PERMITTED_FOR_PURPOSE", `PURPOSE_${p}`);
    if (basis === "consent") {
      if (!model.purposeConsents.has(p)) return deny("PURPOSE_CONSENT_MISSING", `PURPOSE_${p}`);
      if (!model.vendorConsents.has(VENDOR_ID)) return deny("VENDOR_CONSENT_MISSING");
    } else {
      if (!model.purposeLegitimateInterests.has(p)) return deny("PURPOSE_LI_NOT_ESTABLISHED", `PURPOSE_${p}`);
      if (!model.vendorLegitimateInterests.has(VENDOR_ID)) return deny("VENDOR_LI_MISSING");
    }
  }
  return allow("TCF_ALLOWED");
}

/** A4.1 jurisdiction routing. Pure function of the bid request (plus the pinned GVL). */
export function evaluatePolicy(bidRequest: Obj, gvl: GvlInfo = loadGvl()): PolicyResult {
  const warnings: string[] = [];
  const regs = obj(bidRequest.regs) ?? {};
  const user = obj(bidRequest.user) ?? {};
  const geo = obj(obj(bidRequest.device)?.geo);
  const countryRaw = geo?.country;
  const country = typeof countryRaw === "string" && /^[A-Z]{3}$/.test(countryRaw) ? countryRaw : null;
  if (countryRaw !== undefined && !country) warnings.push("COUNTRY_NOT_ISO3");
  const gdpr = regs.gdpr === 1 ? 1 : regs.gdpr === 0 ? 0 : regs.gdpr === undefined ? null : "invalid";
  const coppa = regs.coppa === 1;

  const childAudience: Verdict | null = coppa ? deny("CHILD_DIRECTED_BLOCK") : null;

  if (gdpr === "invalid") {
    warnings.push("REGS_GDPR_INVALID");
    return { jurisdiction: "UNKNOWN", rule: "J6", content: deny("UNKNOWN_JURISDICTION"), audience: childAudience ?? deny("UNKNOWN_JURISDICTION"), warnings };
  }
  if (gdpr === 1 || (gdpr === null && country && GDPR_COUNTRIES.has(country))) {
    const decoded = decodeTcString(user.consent);
    const juris = gdpr === 1 ? "GDPR (regs.gdpr=1)" : `GDPR (gdpr omitted, country ${country})`;
    if ("error" in decoded) {
      return { jurisdiction: juris, rule: "J2", content: deny(decoded.error), audience: childAudience ?? deny(decoded.error), warnings };
    }
    const content = evaluateTcf(decoded.model, PURPOSES_FOR.content, gvl, warnings);
    const audience = childAudience ?? evaluateTcf(decoded.model, PURPOSES_FOR.audience, gvl, warnings);
    return { jurisdiction: juris, rule: "J2", content, audience, warnings };
  }
  if (gdpr === 0 && country === "IND") {
    return {
      jurisdiction: "IND",
      rule: "J3",
      content: allow("JURISDICTION_RULE_ALLOW_ILLUSTRATIVE"),
      audience: childAudience ?? deny("NO_SUPPORTED_CONSENT_FRAMEWORK"),
      warnings,
    };
  }
  if (gdpr === 0 && country === "USA") {
    return { jurisdiction: "USA", rule: "J4", content: allow("JURISDICTION_RULE_ALLOW_ILLUSTRATIVE"), audience: childAudience ?? deny("GPP_NOT_SUPPORTED"), warnings };
  }
  if (gdpr === 0 && country) {
    return { jurisdiction: country, rule: "J5", content: deny("JURISDICTION_NOT_CONFIGURED"), audience: childAudience ?? deny("JURISDICTION_NOT_CONFIGURED"), warnings };
  }
  return { jurisdiction: "UNKNOWN", rule: "J6", content: deny("UNKNOWN_JURISDICTION"), audience: childAudience ?? deny("UNKNOWN_JURISDICTION"), warnings };
}
