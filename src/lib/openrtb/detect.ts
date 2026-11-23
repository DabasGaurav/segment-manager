/**
 * L0 detector: classifies every Data object and Segment in an OpenRTB 2.6 bid request.
 *
 * Rules: Phase 3.1 §A2.2. Spec references (OpenRTB 2.6):
 *   §3.2.21 Data  { id, name, cids, segment[], ext }      — "A bid request can mix data objects from multiple providers."
 *   §3.2.22 Segment { id, name, value, ext }              — id is "specific to the data provider".
 *   segtax community extension: Data.ext.segtax (integer) qualifies ALL segment IDs in that Data object.
 *
 * The detector never mutates its input. It only reports what the resolver should do with each signal.
 */
import type { Registry, TaxonomyNode } from "@/lib/taxonomy/registry";
import { classifySegtax } from "./segtax";

export const DATA_LOCATIONS = [
  { key: "site.content.data", container: ["site", "content"], locationClass: "content" },
  { key: "app.content.data", container: ["app", "content"], locationClass: "content" },
  { key: "dooh.content.data", container: ["dooh", "content"], locationClass: "content" },
  { key: "user.data", container: ["user"], locationClass: "audience" },
] as const;

export type DataLocation = (typeof DATA_LOCATIONS)[number]["key"];
export type LocationClass = "content" | "audience";
export type SignalClass = "CONTENT_TOPIC" | "AUDIENCE_INTEREST" | "PURCHASE_INTENT" | "DEMOGRAPHIC";

export type SegmentNextStep = "PASS_THROUGH_SUBJECT_TO_POLICY" | "TRANSLATION_CANDIDATE" | "REMOVE";
export type SegmentStatus = "VALID_STANDARD" | "PROPRIETARY" | "VENDOR" | "UNVALIDATED_STANDARD" | "INVALID";

export const MAX_SEGMENT_ID_LENGTH = 256;

export interface SegmentDetection {
  path: string;
  raw_id: string | null;
  status: SegmentStatus;
  next_step: SegmentNextStep;
  signal_class: SignalClass | null;
  reason_codes: string[];
  node?: { taxonomy: string; segtax: number; id: string; name: string; path: string[] };
}

export interface DataObjectDetection {
  path: string;
  location: DataLocation;
  location_class: LocationClass;
  provider_name: string | null;
  segtax: number | null;
  segtax_name: string | null;
  next_step: "EVALUATE_SEGMENTS" | "REMOVE_OBJECT";
  reason_codes: string[];
  warnings: string[];
  segments: SegmentDetection[];
}

export interface LocationError {
  path: string;
  reason_codes: string[];
}

export interface DetectionReport {
  data_objects: DataObjectDetection[];
  location_errors: LocationError[];
  info: { code: string; detail: string }[];
  summary: {
    data_objects: number;
    segments: number;
    valid_standard: number;
    proprietary: number;
    removed: number;
    other_pass_through: number;
  };
}

type Json = unknown;

export const isPlainObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const own = (o: Record<string, Json>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function getContainer(req: Record<string, Json>, keys: readonly string[]): Record<string, Json> | null {
  let cur: Json = req;
  for (const k of keys) {
    if (!isPlainObject(cur) || !own(cur, k)) return null;
    cur = cur[k];
  }
  return isPlainObject(cur) ? cur : null;
}

function audienceClass(node: TaxonomyNode): SignalClass {
  if (node.tier1.startsWith("Purchase Intent")) return "PURCHASE_INTENT";
  if (node.tier1 === "Demographic") return "DEMOGRAPHIC";
  return "AUDIENCE_INTEREST";
}

/** segtax location problems that do NOT make the value usable (Phase 3.1: SEGTAX_NONSTANDARD_LOCATION). */
function hasNonstandardSegtax(d: Record<string, Json>): boolean {
  if (own(d, "segtax")) return true;
  const segs = d.segment;
  if (Array.isArray(segs)) {
    return segs.some((s) => isPlainObject(s) && isPlainObject(s.ext) && own(s.ext, "segtax"));
  }
  return false;
}

function readSegmentId(s: Json): string | null {
  if (!isPlainObject(s) || !own(s, "id")) return null;
  const id = s.id;
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_SEGMENT_ID_LENGTH) return null;
  return id;
}

function removeAll(
  segs: Json[],
  objPath: string,
  codes: string[],
): SegmentDetection[] {
  return segs.map((s, j) => ({
    path: `${objPath}.segment[${j}]`,
    raw_id: isPlainObject(s) && typeof s.id === "string" ? s.id : null,
    status: "INVALID" as const,
    next_step: "REMOVE" as const,
    signal_class: null,
    reason_codes: [...codes],
  }));
}

function detectDataObject(
  reg: Registry,
  d: Json,
  objPath: string,
  location: DataLocation,
  locationClass: LocationClass,
): DataObjectDetection {
  const base = {
    path: objPath,
    location,
    location_class: locationClass,
    provider_name: null as string | null,
    segtax: null as number | null,
    segtax_name: null as string | null,
    warnings: [] as string[],
  };

  if (!isPlainObject(d)) {
    return { ...base, next_step: "REMOVE_OBJECT", reason_codes: ["MALFORMED_DATA_OBJECT"], segments: [] };
  }
  base.provider_name = typeof d.name === "string" && d.name.length > 0 ? d.name : null;
  if (!base.provider_name) base.warnings.push("MISSING_PROVIDER_NAME");

  if (own(d, "segment") && !Array.isArray(d.segment)) {
    return { ...base, next_step: "REMOVE_OBJECT", reason_codes: ["MALFORMED_DATA_OBJECT"], segments: [] };
  }
  const segs: Json[] = Array.isArray(d.segment) ? d.segment : [];
  if (segs.length === 0) {
    return { ...base, next_step: "REMOVE_OBJECT", reason_codes: ["EMPTY_DATA_OBJECT"], segments: [] };
  }

  // --- Resolve segtax: only Data.ext.segtax counts. ---
  const ext = d.ext;
  const hasSegtax = isPlainObject(ext) && own(ext, "segtax");
  if (!hasSegtax) {
    if (hasNonstandardSegtax(d)) base.warnings.push("SEGTAX_NONSTANDARD_LOCATION");
    return {
      ...base,
      next_step: "EVALUATE_SEGMENTS",
      reason_codes: ["PROPRIETARY_NO_SEGTAX"],
      segments: segs.map((s, j) => proprietarySegment(s, `${objPath}.segment[${j}]`)),
    };
  }

  const raw = (ext as Record<string, Json>).segtax;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw)) {
    return reject(base, segs, objPath, "SEGTAX_INVALID_VALUE");
  }
  const info = classifySegtax(raw);
  base.segtax = raw;
  base.segtax_name = info.name;

  switch (info.kind) {
    case "INVALID":
      return reject(base, segs, objPath, "SEGTAX_INVALID_VALUE");
    case "DEPRECATED":
      return reject(base, segs, objPath, "DEPRECATED_SEGTAX");
    case "AD_PRODUCT":
      return reject(base, segs, objPath, "MISPLACED_TAXONOMY");
    case "VENDOR":
      return {
        ...base,
        next_step: "EVALUATE_SEGMENTS",
        reason_codes: ["VENDOR_SEGTAX"],
        segments: segs.map((s, j) => passUnvalidated(s, `${objPath}.segment[${j}]`, "VENDOR", "VENDOR_SEGTAX", locationClass)),
      };
    case "CONTENT_UNVALIDATED":
      if (locationClass !== "content") return reject(base, segs, objPath, "MISPLACED_TAXONOMY");
      return {
        ...base,
        next_step: "EVALUATE_SEGMENTS",
        reason_codes: ["UNVALIDATED_STANDARD_SEGTAX"],
        warnings: [...base.warnings, "TAXONOMY_FILE_NOT_LOADED"],
        segments: segs.map((s, j) =>
          passUnvalidated(s, `${objPath}.segment[${j}]`, "UNVALIDATED_STANDARD", "UNVALIDATED_STANDARD_SEGTAX", locationClass),
        ),
      };
    case "AUDIENCE":
    case "CONTENT": {
      const expected: LocationClass = info.kind === "AUDIENCE" ? "audience" : "content";
      if (expected !== locationClass) return reject(base, segs, objPath, "MISPLACED_TAXONOMY");
      const tax = reg.bySegtax.get(raw);
      if (!tax) throw new Error(`registry missing loaded taxonomy for segtax ${raw}`);
      const seen = new Set<string>();
      const segments = segs.map((s, j): SegmentDetection => {
        const p = `${objPath}.segment[${j}]`;
        const id = readSegmentId(s);
        if (id === null) return malformedSegment(s, p);
        const node = tax.nodes.get(id);
        if (!node) {
          return { path: p, raw_id: id, status: "INVALID", next_step: "REMOVE", signal_class: null, reason_codes: ["SEGTAX_ID_NOT_IN_TAXONOMY"] };
        }
        const codes = ["VALID_STANDARD"];
        if (seen.has(id)) codes.push("DUPLICATE_SEGMENT");
        seen.add(id);
        return {
          path: p,
          raw_id: id,
          status: "VALID_STANDARD",
          next_step: "PASS_THROUGH_SUBJECT_TO_POLICY",
          signal_class: tax.kind === "content" ? "CONTENT_TOPIC" : audienceClass(node),
          reason_codes: codes,
          node: { taxonomy: tax.key, segtax: tax.segtax, id: node.id, name: node.name, path: node.path },
        };
      });
      return { ...base, next_step: "EVALUATE_SEGMENTS", reason_codes: ["STANDARD_SEGTAX"], segments };
    }
  }
}

function reject(
  base: Omit<DataObjectDetection, "next_step" | "reason_codes" | "segments">,
  segs: Json[],
  objPath: string,
  code: string,
): DataObjectDetection {
  return { ...base, next_step: "REMOVE_OBJECT", reason_codes: [code], segments: removeAll(segs, objPath, [code]) };
}

function malformedSegment(s: Json, p: string): SegmentDetection {
  return {
    path: p,
    raw_id: isPlainObject(s) && typeof s.id === "string" ? s.id.slice(0, MAX_SEGMENT_ID_LENGTH) : null,
    status: "INVALID",
    next_step: "REMOVE",
    signal_class: null,
    reason_codes: ["MALFORMED_SEGMENT"],
  };
}

function proprietarySegment(s: Json, p: string): SegmentDetection {
  const id = readSegmentId(s);
  if (id === null) return malformedSegment(s, p);
  const codes = ["PROPRIETARY_NO_SEGTAX"];
  if (isPlainObject(s) && own(s, "value")) codes.push("SEGMENT_HAS_VALUE");
  return { path: p, raw_id: id, status: "PROPRIETARY", next_step: "TRANSLATION_CANDIDATE", signal_class: null, reason_codes: codes };
}

function passUnvalidated(
  s: Json,
  p: string,
  status: "VENDOR" | "UNVALIDATED_STANDARD",
  code: string,
  locationClass: LocationClass,
): SegmentDetection {
  const id = readSegmentId(s);
  if (id === null) return malformedSegment(s, p);
  return {
    path: p,
    raw_id: id,
    status,
    next_step: "PASS_THROUGH_SUBJECT_TO_POLICY",
    // Class unknown beyond the location: the policy layer treats it by location class.
    signal_class: locationClass === "content" ? "CONTENT_TOPIC" : null,
    reason_codes: [code],
  };
}

export function detectSignals(reg: Registry, bidRequest: Record<string, Json>): DetectionReport {
  const data_objects: DataObjectDetection[] = [];
  const location_errors: LocationError[] = [];

  for (const loc of DATA_LOCATIONS) {
    const container = getContainer(bidRequest, loc.container);
    if (!container || !own(container, "data")) continue;
    const arr = container.data;
    if (!Array.isArray(arr)) {
      location_errors.push({ path: loc.key, reason_codes: ["MALFORMED_DATA_OBJECT"] });
      continue;
    }
    arr.forEach((d, i) => data_objects.push(detectDataObject(reg, d, `${loc.key}[${i}]`, loc.key, loc.locationClass)));
  }

  // Informational: same provider sending several content taxonomy versions is allowed by the spec.
  const info: DetectionReport["info"] = [];
  const versionsByProvider = new Map<string, Set<number>>();
  for (const o of data_objects) {
    if (o.location_class !== "content" || o.segtax === null || o.next_step === "REMOVE_OBJECT") continue;
    const k = `${o.location}|${o.provider_name ?? ""}`;
    const set = versionsByProvider.get(k) ?? new Set<number>();
    set.add(o.segtax);
    versionsByProvider.set(k, set);
  }
  for (const [k, set] of versionsByProvider) {
    if (set.size > 1) {
      info.push({
        code: "MULTIPLE_CONTENT_VERSIONS",
        detail: `${k.replace("|", " / provider ")} sends segtax ${[...set].sort((a, b) => a - b).join(", ")} in separate Data objects; each is validated independently.`,
      });
    }
  }

  const all = data_objects.flatMap((o) => o.segments);
  return {
    data_objects,
    location_errors,
    info,
    summary: {
      data_objects: data_objects.length,
      segments: all.length,
      valid_standard: all.filter((s) => s.status === "VALID_STANDARD").length,
      proprietary: all.filter((s) => s.status === "PROPRIETARY").length,
      removed: all.filter((s) => s.next_step === "REMOVE").length,
      other_pass_through: all.filter((s) => s.status === "VENDOR" || s.status === "UNVALIDATED_STANDARD").length,
    },
  };
}
