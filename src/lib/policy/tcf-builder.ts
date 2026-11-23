/**
 * Builds real TCF v2 consent strings with the official IAB encoder, for tests and the Bid Lab presets.
 * The strings are SYNTHETIC (no real user, CMP id 2 used for testing).
 */
import { GVL, PurposeRestriction, Segment, TCModel, TCString } from "@iabtechlabtcf/core";

export interface TcOptions {
  purposeConsents?: number[];
  purposeLI?: number[];
  vendorConsent?: boolean;
  vendorLI?: boolean;
  disclosed?: boolean | "other-only";
  serviceSpecific?: boolean;
  purposeOneTreatment?: boolean;
  restrictions?: { purpose: number; type: 0 | 1 | 2 }[];
  /** Vendor 142's declaration in the encoder's GVL (the encoder drops signals the GVL makes meaningless). */
  encoderVendor?: { purposes: number[]; legIntPurposes: number[]; flexiblePurposes: number[] };
}

function minimalGvl(v: TcOptions["encoderVendor"]) {
  const purposes: Record<string, unknown> = {};
  for (let i = 1; i <= 11; i++) purposes[i] = { id: i, name: `Purpose ${i}`, description: "", illustrations: [] };
  return new GVL({
    gvlSpecificationVersion: 3,
    vendorListVersion: 1,
    tcfPolicyVersion: 5,
    lastUpdated: "2026-11-23T00:00:00Z",
    purposes,
    specialPurposes: {},
    features: {},
    specialFeatures: {},
    stacks: {},
    dataCategories: {},
    vendors: {
      "142": { id: 142, name: "vendor 142", ...(v ?? { purposes: [1, 3, 4], legIntPurposes: [2, 7], flexiblePurposes: [2, 7] }), specialPurposes: [], features: [], specialFeatures: [], urls: [] },
      "755": { id: 755, name: "other vendor", purposes: [1], legIntPurposes: [], flexiblePurposes: [], specialPurposes: [], features: [], specialFeatures: [], urls: [] },
    },
  } as never);
}

export function buildTcString(o: TcOptions = {}): string {
  const m = new TCModel(minimalGvl(o.encoderVendor));
  m.cmpId = 2;
  m.cmpVersion = 1;
  m.isServiceSpecific = o.serviceSpecific ?? true;
  m.purposeOneTreatment = o.purposeOneTreatment ?? false;
  m.publisherCountryCode = "DE";
  for (const p of o.purposeConsents ?? [1, 2, 3, 4]) m.purposeConsents.set(p);
  for (const p of o.purposeLI ?? [2, 7]) m.purposeLegitimateInterests.set(p);
  if (o.vendorConsent ?? true) m.vendorConsents.set(142);
  if (o.vendorLI ?? true) m.vendorLegitimateInterests.set(142);
  const disclosed = o.disclosed ?? true;
  if (disclosed === true) m.vendorsDisclosed.set(142);
  if (disclosed === "other-only") m.vendorsDisclosed.set(755);
  for (const r of o.restrictions ?? []) m.publisherRestrictions.add(142, new PurposeRestriction(r.purpose, r.type));
  const segments = [Segment.CORE, ...(disclosed ? [Segment.VENDORS_DISCLOSED] : [])];
  return TCString.encode(m, { segments });
}
