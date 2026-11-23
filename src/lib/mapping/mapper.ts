/**
 * Mapping ladder (Phase 3 §3.2, as amended by Phase 3.1).
 *
 *   L1 cross-version  — the publisher declares its entry equals a standard ID; same ID and name in the
 *                       target file means exact.
 *   L2 declaration    — the normalised label/description equals an official node name in the allowed branch
 *                       (directly or via the reviewed synonym table).
 *   L3 retrieval      — token overlap over node names and paths in the allowed branch; ranking only,
 *                       never auto-approved; close calls abstain.
 *   L4 review         — a human decides (separate module).
 *
 * Invariants enforced here (each has a test):
 *   - Class comes from the publisher's declaration plus the field; label words never decide it.
 *   - Purchase intent is never auto-approved.
 *   - Never narrower than the evidence: synonym matches that are wider are flagged LOSSY_BROADER_MATCH.
 *   - Sensitive labels and sensitive target nodes are BLOCKED.
 *   - Every proposal carries at least one reason code.
 */
import synonymsFile from "../../../data/config/synonyms.json";
import { isSensitiveLabel, isSensitiveNode } from "@/lib/policy/sensitive";
import type { LoadedTaxonomy, Registry, TaxonomyNode } from "@/lib/taxonomy/registry";
import type { SignalClass } from "@/lib/openrtb/detect";

export type Field = "content" | "user";

export interface DictionaryEntryInput {
  raw_id: string;
  field: Field;
  label: string;
  description?: string | null;
  declared_class: SignalClass;
  declared_source?: string | null;
  declared_standard?: { segtax: number; id: string } | null;
}

export type ProposalStatus = "PENDING_REVIEW" | "APPROVED" | "ABSTAINED" | "BLOCKED";
export type MatchType = "exact" | "broader" | "candidate";

export interface Candidate {
  segtax: number;
  id: string;
  name: string;
  path: string[];
  score: number;
  relation: MatchType;
}

export interface ProposalDraft {
  raw_id: string;
  field: Field;
  label: string | null;
  signal_class: SignalClass | null;
  status: ProposalStatus;
  method: string;
  target: { segtax: number; id: string } | null;
  match_type: MatchType | null;
  match_score: number | null;
  candidates: Candidate[];
  reason_codes: string[];
  auto_approved: boolean;
}

/** Sources that can justify a purchase-intent segment (illustrative list, owned by policy). */
export const INTENT_SOURCES = ["purchase_data", "transaction", "lead_form", "cart_activity", "test_drive_booking"] as const;

export const CONTENT_TARGET_SEGTAX = 7; // Content 3.0 (Phase 3.1 §A2.3 step 4)
export const AUDIENCE_TARGET_SEGTAX = 4; // Audience 1.1

export const L3_MIN_SCORE = 1.0;
export const L3_AMBIGUITY_RATIO = 0.9; // second candidate within 10% of the first -> abstain

interface Synonym {
  term: string;
  node_name: string;
  relation: "exact" | "broader";
}
const SYNONYMS: Synonym[] = (synonymsFile as { entries: Synonym[] }).entries;
export const SYNONYM_VERSION: string = (synonymsFile as { version: string }).version;

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "about", "with", "who", "that", "readers", "reader",
  "users", "user", "people", "visitors", "audience", "articles", "article", "news", "content", "pages", "page", "section",
  "interested", "interest", "intenders", "intender", "fans", "segment", "seg", "our", "their", "is", "are", "by", "or",
]);

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Light plural folding so "Smartphone" meets "Smartphones" and "car" meets "Cars". No other stemming. */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) return t.slice(0, -1);
  return t;
}

function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t))
    .map(stem)
    .filter((t) => !STOPWORDS.has(t));
}

export function expectedFieldFor(cls: SignalClass): Field {
  return cls === "CONTENT_TOPIC" ? "content" : "user";
}

/** The only nodes a class may map to. Sensitive nodes are never offered. */
export function branchFor(reg: Registry, cls: SignalClass): { tax: LoadedTaxonomy; nodes: TaxonomyNode[] } | null {
  if (cls === "CONTENT_TOPIC") {
    const tax = reg.bySegtax.get(CONTENT_TARGET_SEGTAX)!;
    return { tax, nodes: [...tax.nodes.values()].filter((n) => !isSensitiveNode(n)) };
  }
  const tax = reg.bySegtax.get(AUDIENCE_TARGET_SEGTAX)!;
  const tier1 = cls === "AUDIENCE_INTEREST" ? "Interest" : cls === "PURCHASE_INTENT" ? "Purchase Intent*" : null;
  if (!tier1) return null;
  return { tax, nodes: [...tax.nodes.values()].filter((n) => n.tier1 === tier1 && !isSensitiveNode(n)) };
}

/** Is `target` a node this class may map to? (used by review and publish too) */
export function targetAllowed(reg: Registry, cls: SignalClass, segtax: number, id: string): { ok: true; node: TaxonomyNode } | { ok: false; code: string } {
  const expectedSegtax = cls === "CONTENT_TOPIC" ? CONTENT_TARGET_SEGTAX : AUDIENCE_TARGET_SEGTAX;
  if (segtax !== expectedSegtax) return { ok: false, code: "CLASS_FIELD_MISMATCH" };
  const tax = reg.bySegtax.get(segtax);
  const node = tax?.nodes.get(id);
  if (!node) return { ok: false, code: "INVALID_TAXONOMY_ID" };
  if (isSensitiveNode(node)) return { ok: false, code: "SENSITIVE_OVERRIDE_FORBIDDEN" };
  if (cls === "AUDIENCE_INTEREST" && node.tier1 !== "Interest") return { ok: false, code: "CLASS_FIELD_MISMATCH" };
  if (cls === "PURCHASE_INTENT" && node.tier1 !== "Purchase Intent*") return { ok: false, code: "CLASS_FIELD_MISMATCH" };
  if (cls === "DEMOGRAPHIC") return { ok: false, code: "CLASS_NOT_SUPPORTED" };
  return { ok: true, node };
}

const cand = (tax: LoadedTaxonomy, n: TaxonomyNode, score: number, relation: MatchType): Candidate => ({
  segtax: tax.segtax,
  id: n.id,
  name: n.name,
  path: n.path,
  score: Math.round(score * 100) / 100,
  relation,
});

function base(e: DictionaryEntryInput): Omit<ProposalDraft, "status" | "method" | "reason_codes"> {
  return {
    raw_id: e.raw_id,
    field: e.field,
    label: e.label,
    signal_class: e.declared_class,
    target: null,
    match_type: null,
    match_score: null,
    candidates: [],
    auto_approved: false,
  };
}

/** Finalise a matched proposal: auto-approve only exact, non-intent matches. */
function matched(
  e: DictionaryEntryInput,
  method: string,
  tax: LoadedTaxonomy,
  node: TaxonomyNode,
  relation: MatchType,
  score: number,
  extra: Candidate[] = [],
  codes: string[] = [],
): ProposalDraft {
  const reason = [...codes];
  reason.push(relation === "exact" ? "EXACT_MATCH" : relation === "broader" ? "LOSSY_BROADER_MATCH" : "LEXICAL_CANDIDATE");
  const intent = e.declared_class === "PURCHASE_INTENT";
  if (intent) {
    reason.push("PROMOTION_REVIEW_REQUIRED");
    if (!INTENT_SOURCES.includes((e.declared_source ?? "") as (typeof INTENT_SOURCES)[number])) reason.push("INTENT_SOURCE_NOT_DECLARED");
  }
  const auto = relation === "exact" && !intent;
  return {
    ...base(e),
    status: auto ? "APPROVED" : "PENDING_REVIEW",
    method,
    target: { segtax: tax.segtax, id: node.id },
    match_type: relation,
    match_score: score,
    candidates: [cand(tax, node, score, relation), ...extra],
    reason_codes: reason,
    auto_approved: auto,
  };
}

export function mapEntry(reg: Registry, e: DictionaryEntryInput): ProposalDraft {
  // 0. Policy first: sensitive labels never get a mapping, whatever the class.
  if (isSensitiveLabel(e.label, e.description, e.raw_id)) {
    return { ...base(e), status: "BLOCKED", method: "POLICY", reason_codes: ["SENSITIVE_CATEGORY"] };
  }
  if (e.declared_class === "DEMOGRAPHIC") {
    return { ...base(e), status: "ABSTAINED", method: "POLICY", reason_codes: ["CLASS_NOT_SUPPORTED"] };
  }
  const branch = branchFor(reg, e.declared_class);
  if (!branch) return { ...base(e), status: "ABSTAINED", method: "POLICY", reason_codes: ["CLASS_NOT_SUPPORTED"] };
  const { tax, nodes } = branch;

  // 1. L1: publisher-declared standard equivalent.
  if (e.declared_standard) {
    const src = reg.bySegtax.get(e.declared_standard.segtax);
    const srcNode = src?.nodes.get(e.declared_standard.id);
    if (!src || !srcNode) {
      return { ...base(e), status: "PENDING_REVIEW", method: "L1", reason_codes: ["L1_DECLARED_ID_UNKNOWN", "ABSTAIN_INSUFFICIENT"] };
    }
    const same = tax.nodes.get(srcNode.id);
    const inBranch = same && nodes.includes(same);
    if (same && inBranch && normalise(same.name) === normalise(srcNode.name)) {
      return matched(e, "L1", tax, same, "exact", 1, [], src.segtax === tax.segtax ? [] : ["CROSS_VERSION_SAME_ID_AND_NAME"]);
    }
    if (same && inBranch) return matched(e, "L1", tax, same, "candidate", 0.5, [], ["L1_NAME_CHANGED"]);
    // fall through to L2/L3 with a note
  }

  const label = normalise(e.label);
  const desc = normalise(e.description ?? "");

  // 2. L2: exact name equality in the allowed branch.
  for (const text of [label, desc]) {
    if (!text) continue;
    const hits = nodes.filter((n) => normalise(n.name) === text);
    if (hits.length === 1) return matched(e, "L2", tax, hits[0]!, "exact", 1);
    if (hits.length > 1) {
      return {
        ...base(e),
        status: "PENDING_REVIEW",
        method: "L2",
        candidates: hits.slice(0, 3).map((n) => cand(tax, n, 1, "exact")),
        reason_codes: ["ABSTAIN_AMBIGUOUS", ...(e.declared_class === "PURCHASE_INTENT" ? ["PROMOTION_REVIEW_REQUIRED"] : [])],
      };
    }
  }

  // 2b. L2 via the reviewed synonym table (whole-phrase match in label or description).
  const padded = ` ${label} ${desc} `;
  const synHits = SYNONYMS.filter((s) => padded.includes(` ${normalise(s.term)} `));
  if (synHits.length > 0) {
    const targets = new Map<string, { node: TaxonomyNode; relation: MatchType }>();
    for (const s of synHits) {
      for (const n of nodes) if (normalise(n.name) === normalise(s.node_name)) targets.set(n.id, { node: n, relation: s.relation });
    }
    if (targets.size === 1) {
      const { node, relation } = [...targets.values()][0]!;
      // A synonym hit is human-curated evidence, but it is still a translation: review unless exact.
      return matched(e, "L2+SYN", tax, node, relation, 1);
    }
    if (targets.size > 1) {
      return {
        ...base(e),
        status: "PENDING_REVIEW",
        method: "L2+SYN",
        candidates: [...targets.values()].slice(0, 3).map((t) => cand(tax, t.node, 1, t.relation)),
        reason_codes: ["ABSTAIN_AMBIGUOUS", ...(e.declared_class === "PURCHASE_INTENT" ? ["PROMOTION_REVIEW_REQUIRED"] : [])],
      };
    }
  }

  // 3. L3: lexical retrieval inside the branch. Ranking only.
  const q = [...new Set([...tokens(e.label), ...tokens(e.description ?? "")])];
  if (q.length === 0) {
    return { ...base(e), status: "PENDING_REVIEW", method: "L3", reason_codes: ["ABSTAIN_INSUFFICIENT"] };
  }
  const df = new Map<string, number>();
  const nodeTokens = nodes.map((n) => {
    const nameT = new Set(tokens(n.name));
    const pathT = new Set(n.path.slice(0, -1).flatMap(tokens));
    for (const t of new Set([...nameT, ...pathT])) df.set(t, (df.get(t) ?? 0) + 1);
    return { n, nameT, pathT };
  });
  const N = nodes.length;
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const scored = nodeTokens
    .map(({ n, nameT, pathT }) => {
      let s = 0;
      for (const t of q) {
        if (nameT.has(t)) s += 2 * idf(t);
        else if (pathT.has(t)) s += 0.5 * idf(t);
      }
      // Prefer the node whose own name is covered most completely (avoid rewarding deep, narrower nodes).
      const cover = nameT.size ? [...nameT].filter((t) => q.includes(t)).length / nameT.size : 0;
      return { n, s: s * (0.5 + 0.5 * cover) };
    })
    .filter((x) => x.s >= L3_MIN_SCORE)
    .sort((a, b) => b.s - a.s || a.n.path.length - b.n.path.length);

  if (scored.length === 0) {
    return { ...base(e), status: "PENDING_REVIEW", method: "L3", reason_codes: ["ABSTAIN_INSUFFICIENT"] };
  }
  const top = scored.slice(0, 3).map((x) => cand(tax, x.n, x.s, "candidate"));
  if (scored.length > 1 && scored[1]!.s >= L3_AMBIGUITY_RATIO * scored[0]!.s) {
    return {
      ...base(e),
      status: "PENDING_REVIEW",
      method: "L3",
      candidates: top,
      reason_codes: ["ABSTAIN_AMBIGUOUS", ...(e.declared_class === "PURCHASE_INTENT" ? ["PROMOTION_REVIEW_REQUIRED"] : [])],
    };
  }
  return matched(e, "L3", tax, scored[0]!.n, "candidate", scored[0]!.s, top.slice(1));
}

/** IDs seen in samples with no dictionary entry: nothing to go on, so abstain. */
export function abstainUnknown(raw_id: string, field: Field): ProposalDraft {
  return {
    raw_id,
    field,
    label: null,
    signal_class: field === "content" ? "CONTENT_TOPIC" : null,
    status: "PENDING_REVIEW",
    method: "NONE",
    target: null,
    match_type: null,
    match_score: null,
    candidates: [],
    reason_codes: ["NO_DICTIONARY_ENTRY", "ABSTAIN_INSUFFICIENT"],
    auto_approved: false,
  };
}
