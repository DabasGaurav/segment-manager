/**
 * Serving-plane resolver (Phase 3.1 §A2.3, §A3.1, §A3.2). Pure function: no network, no DB, no model.
 * The route loads the publisher, grant and active snapshot, then calls resolveRequest().
 *
 * Every Data object and segment in the input gets exactly one outcome with at least one reason code:
 *   PASSED_THROUGH  valid standard signal forwarded unchanged (no grant needed; policy still applies)
 *   TRANSLATED      proprietary ID replaced by an approved IAB ID (grant + DSP allowlist + policy)
 *   KEPT_RAW        proprietary ID left as sent (not onboarded, third-party, or publisher chose pass_raw)
 *   REMOVED         dropped, with the reason
 */
import { detectSignals, DATA_LOCATIONS, isPlainObject, type DataLocation, type DetectionReport } from "@/lib/openrtb/detect";
import { evaluatePolicy, type PolicyResult, type Verdict, type GvlInfo, POLICY_PACK_VERSION, loadGvl } from "@/lib/policy/consent";
import { isSensitiveNode } from "@/lib/policy/sensitive";
import { targetAllowed } from "@/lib/mapping/mapper";
import type { Registry } from "@/lib/taxonomy/registry";
import type { Snapshot, SnapshotEntry } from "@/lib/services/versions";

export type Outcome = "PASSED_THROUGH" | "TRANSLATED" | "KEPT_RAW" | "REMOVED";

export interface Decision {
  path: string;
  raw_id: string | null;
  provider: string | null;
  outcome: Outcome;
  to?: { segtax: number; id: string; name: string };
  reason_codes: string[];
}

export interface ResolveContext {
  publisher: { id: string; domain: string } | null;
  grant: { level: string; dspAllowlist: string[]; unmappedHandling: "drop" | "pass_raw" } | null;
  snapshot: Snapshot | null;
  mappingVersion: number | null;
  snapshotHash: string | null;
  dsp: string;
  /** "field|raw_id" of the publisher's IDs blocked as sensitive; always removed, whatever the grant says. */
  blockedIds?: string[];
}

export interface ResolveResult {
  status: "OK" | "DEGRADED";
  mapping_version: string | null;
  snapshot_hash: string | null;
  policy_pack_version: string;
  gvl_source: string;
  policy: { jurisdiction: string; rule: string; content: Verdict; audience: Verdict; warnings: string[] } | null;
  bid_request: Record<string, unknown>;
  decisions: Decision[];
  summary: Record<Outcome, number>;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function locationArray(req: Record<string, unknown>, loc: (typeof DATA_LOCATIONS)[number]): { holder: Record<string, unknown>; arr: unknown[] } | null {
  let cur: unknown = req;
  for (const k of loc.container) {
    if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, k)) return null;
    cur = cur[k];
  }
  if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, "data")) return null;
  return { holder: cur, arr: Array.isArray(cur.data) ? cur.data : [] };
}

/** Fail closed: remove every Data object from every location, without relying on detection. */
export function stripAllData(bidRequest: Record<string, unknown>): Record<string, unknown> {
  const out = clone(bidRequest);
  for (const loc of DATA_LOCATIONS) {
    const found = locationArray(out, loc);
    if (found) delete found.holder.data;
  }
  return out;
}

export interface ResolveDeps {
  detect?: typeof detectSignals;
  policy?: (req: Record<string, unknown>, gvl: GvlInfo) => PolicyResult;
}

export function resolveRequest(reg: Registry, bidRequest: Record<string, unknown>, ctx: ResolveContext, deps: ResolveDeps = {}): ResolveResult {
  const gvl = loadGvl();
  const header = {
    mapping_version: ctx.mappingVersion !== null && ctx.publisher ? `${ctx.publisher.id}@${ctx.mappingVersion}` : null,
    snapshot_hash: ctx.snapshotHash,
    policy_pack_version: POLICY_PACK_VERSION,
    gvl_source: gvl.source,
  };
  let detection: DetectionReport | null = null;
  try {
    detection = (deps.detect ?? detectSignals)(reg, bidRequest);
    const policy = (deps.policy ?? evaluatePolicy)(bidRequest, gvl);
    const { decisions, output } = evaluate(reg, bidRequest, detection, policy, ctx);
    return { status: "OK", ...header, policy, bid_request: output, decisions, summary: summarise(decisions) };
  } catch (e) {
    console.error("[resolve] internal error, failing closed", e);
    const decisions: Decision[] = detection
      ? detection.data_objects.flatMap((o) =>
          (o.segments.length ? o.segments : [{ path: o.path, raw_id: null }]).map((s) => ({
            path: s.path,
            raw_id: s.raw_id,
            provider: o.provider_name,
            outcome: "REMOVED" as const,
            reason_codes: ["INTERNAL_FAIL_CLOSED"],
          })),
        )
      : [{ path: "*", raw_id: null, provider: null, outcome: "REMOVED", reason_codes: ["INTERNAL_FAIL_CLOSED"] }];
    return { status: "DEGRADED", ...header, policy: null, bid_request: stripAllData(bidRequest), decisions, summary: summarise(decisions) };
  }
}

function summarise(ds: Decision[]): Record<Outcome, number> {
  const s: Record<Outcome, number> = { PASSED_THROUGH: 0, TRANSLATED: 0, KEPT_RAW: 0, REMOVED: 0 };
  for (const d of ds) s[d.outcome]++;
  return s;
}

function evaluate(reg: Registry, input: Record<string, unknown>, det: DetectionReport, policy: PolicyResult, ctx: ResolveContext) {
  const decisions: Decision[] = [];
  const output = clone(input);
  const onboarded = !!ctx.publisher && !!ctx.grant && ctx.grant.level !== "G0";
  const dspAllowed = onboarded && ctx.grant!.dspAllowlist.includes(ctx.dsp);
  const snap = new Map<string, SnapshotEntry>((ctx.snapshot?.entries ?? []).map((e) => [`${e.field}|${e.raw_id}`, e]));

  const blocked = new Set(ctx.blockedIds ?? []);
  const verdictFor = (locClass: "content" | "audience") => (locClass === "content" ? policy.content : policy.audience);

  for (const loc of DATA_LOCATIONS) {
    const found = locationArray(output, loc);
    if (!found) continue;
    if (!Array.isArray(found.holder.data)) {
      decisions.push({ path: loc.key, raw_id: null, provider: null, outcome: "REMOVED", reason_codes: ["MALFORMED_DATA_OBJECT"] });
      delete found.holder.data;
      continue;
    }
    const objs = det.data_objects.filter((o) => o.location === (loc.key as DataLocation));
    const kept: unknown[] = [];
    // (provider name, target segtax) -> output object (Phase 3.1 §A2.3 step 2)
    const translatedObjs = new Map<string, { id?: unknown; name: unknown; ext: { segtax: number }; segment: { id: string }[] }>();

    objs.forEach((o, i) => {
      const original = found.arr[i];
      if (o.next_step === "REMOVE_OBJECT") {
        if (o.segments.length === 0) decisions.push({ path: o.path, raw_id: null, provider: o.provider_name, outcome: "REMOVED", reason_codes: [...o.reason_codes] });
        for (const s of o.segments) decisions.push({ path: s.path, raw_id: s.raw_id, provider: o.provider_name, outcome: "REMOVED", reason_codes: [...s.reason_codes] });
        return;
      }
      const verdict = verdictFor(o.location_class);
      const keepIdx: number[] = [];
      const isOwnProvider = !!ctx.publisher && o.provider_name === ctx.publisher.domain;

      o.segments.forEach((s, j) => {
        const d: Decision = { path: s.path, raw_id: s.raw_id, provider: o.provider_name, outcome: "REMOVED", reason_codes: [] };
        decisions.push(d);
        if (s.next_step === "REMOVE") {
          d.reason_codes.push(...s.reason_codes);
          return;
        }
        if (s.next_step === "PASS_THROUGH_SUBJECT_TO_POLICY") {
          if (s.node && isSensitiveNode(s.node)) {
            d.reason_codes.push(...s.reason_codes, "SENSITIVE_CATEGORY");
            return;
          }
          if (!verdict.allowed) {
            d.reason_codes.push(...s.reason_codes, ...verdict.codes);
            return;
          }
          if (s.reason_codes.includes("DUPLICATE_SEGMENT")) {
            d.reason_codes.push(...s.reason_codes);
            return; // drop the repeat, keep the first
          }
          d.outcome = "PASSED_THROUGH";
          d.reason_codes.push(...s.reason_codes, ...verdict.codes);
          keepIdx.push(j);
          return;
        }
        // Proprietary (TRANSLATION_CANDIDATE or UNMAPPED_HANDLING).
        const fieldKey = `${o.location_class === "content" ? "content" : "user"}|${s.raw_id}`;
        if (isOwnProvider && blocked.has(fieldKey)) {
          d.reason_codes.push("SENSITIVE_CATEGORY");
          return;
        }
        const keepRaw = (codes: string[]) => {
          if (!verdict.allowed) {
            d.reason_codes.push(...codes, ...verdict.codes);
            return;
          }
          d.outcome = "KEPT_RAW";
          d.reason_codes.push(...codes, ...verdict.codes);
          keepIdx.push(j);
        };
        if (!ctx.publisher || !onboarded) return keepRaw(["PROPRIETARY_NO_SEGTAX", "PUBLISHER_NOT_ONBOARDED"]);
        if (!isOwnProvider) return keepRaw(["PROPRIETARY_NO_SEGTAX", "THIRD_PARTY_PROVIDER_NOT_TRANSLATED"]);

        const field = o.location_class === "content" ? "content" : "user";
        const entry = s.next_step === "TRANSLATION_CANDIDATE" ? snap.get(`${field}|${s.raw_id}`) : undefined;
        if (entry) {
          if (!dspAllowed) {
            d.reason_codes.push("GRANT_NOT_ALLOWED_FOR_DSP");
            return;
          }
          const ok = targetAllowed(reg, entry.signal_class, entry.target_segtax, entry.target_id);
          if (!ok.ok) {
            d.reason_codes.push(ok.code === "SENSITIVE_OVERRIDE_FORBIDDEN" ? "SENSITIVE_CATEGORY" : "INVALID_TAXONOMY_ID");
            return;
          }
          if (!verdict.allowed) {
            d.reason_codes.push(...entry.reason_codes, ...verdict.codes);
            return;
          }
          d.outcome = "TRANSLATED";
          d.to = { segtax: entry.target_segtax, id: entry.target_id, name: ok.node.name };
          d.reason_codes.push(...(entry.reason_codes.length ? entry.reason_codes : ["APPROVED_MAPPING"]), ...verdict.codes);
          const key = `${o.provider_name}|${entry.target_segtax}`;
          let t = translatedObjs.get(key);
          if (!t) {
            const src = original as Record<string, unknown>;
            t = { ...(src.id !== undefined ? { id: src.id } : {}), name: src.name, ext: { segtax: entry.target_segtax }, segment: [] };
            translatedObjs.set(key, t);
          }
          if (!t.segment.some((x) => x.id === entry.target_id)) t.segment.push({ id: entry.target_id });
          return;
        }
        const why = s.next_step === "UNMAPPED_HANDLING" ? s.reason_codes.slice(1) : ["NO_APPROVED_MAPPING"];
        if (ctx.grant!.unmappedHandling === "drop") {
          d.reason_codes.push(...why, "UNMAPPED_DROP_PER_PUBLISHER");
          return;
        }
        keepRaw([...why, "UNMAPPED_PASS_RAW_PER_PUBLISHER"]);
      });

      if (keepIdx.length > 0) {
        const src = clone(original) as Record<string, unknown>;
        const segs = src.segment as unknown[];
        src.segment = keepIdx.map((k) => segs[k]);
        kept.push(src);
      }
    });

    const finalArr = [...kept, ...translatedObjs.values()];
    if (finalArr.length > 0) found.holder.data = finalArr;
    else delete found.holder.data;
  }
  return { decisions, output };
}
