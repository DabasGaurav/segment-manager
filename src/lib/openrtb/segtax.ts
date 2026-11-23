/**
 * segtax classification.
 *
 * segtax is the community extension Data.ext.segtax (integer). It qualifies every Segment ID in
 * that Data object. Without it, segment IDs are proprietary to the data provider.
 * Values: AdCOM 1.0 "List: Category Taxonomies".
 */
export type SegtaxKind =
  | "AUDIENCE" // 4: loaded, validated
  | "CONTENT" // 6, 7, 9: loaded, validated
  | "CONTENT_UNVALIDATED" // 5: Content 2.1, standard but file not loaded in P0
  | "DEPRECATED" // 1, 2
  | "AD_PRODUCT" // 3, 8: never valid inside a Data object
  | "VENDOR" // 500+
  | "INVALID"; // anything else

export interface SegtaxInfo {
  value: number;
  kind: SegtaxKind;
  name: string;
}

const NAMED: Record<number, { kind: SegtaxKind; name: string }> = {
  1: { kind: "DEPRECATED", name: "IAB Content Category Taxonomy 1.0 (deprecated)" },
  2: { kind: "DEPRECATED", name: "IAB Content Category Taxonomy 2.0 (deprecated)" },
  3: { kind: "AD_PRODUCT", name: "IAB Ad Product Taxonomy 1.0" },
  4: { kind: "AUDIENCE", name: "IAB Audience Taxonomy 1.1" },
  5: { kind: "CONTENT_UNVALIDATED", name: "IAB Content Taxonomy 2.1" },
  6: { kind: "CONTENT", name: "IAB Content Taxonomy 2.2" },
  7: { kind: "CONTENT", name: "IAB Content Taxonomy 3.0" },
  8: { kind: "AD_PRODUCT", name: "IAB Ad Product Taxonomy 2.0" },
  9: { kind: "CONTENT", name: "IAB Content Taxonomy 3.1" },
};

export function classifySegtax(value: number): SegtaxInfo {
  const named = NAMED[value];
  if (named) return { value, ...named };
  if (Number.isSafeInteger(value) && value >= 500) return { value, kind: "VENDOR", name: "Vendor-specific taxonomy" };
  return { value, kind: "INVALID", name: "Unassigned value" };
}
