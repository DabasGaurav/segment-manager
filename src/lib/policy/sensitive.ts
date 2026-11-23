/**
 * Sensitive categories (ILLUSTRATIVE policy list, not legal advice).
 * A match is BLOCKED and no reviewer can override it (Phase 3 §3.6).
 * Applied to dictionary labels at import, to every mapping target at review and publish,
 * and to valid standard signals arriving via pass-through at resolve.
 */
import type { TaxonomyNode } from "@/lib/taxonomy/registry";

export const SENSITIVE_POLICY_VERSION = "illustrative-2026-11-23";

/** Official node-name path prefixes treated as sensitive (matched on names, so they hold across versions). */
const SENSITIVE_PATH_PREFIXES: readonly (readonly string[])[] = [
  ["Sensitive Topics"],
  ["Medical Health", "Diseases and Conditions"],
  ["Religion & Spirituality"],
  ["Interest", "Medical Health"],
  ["Interest", "Pharmaceuticals, Conditions, and Symptoms"],
  ["Purchase Intent*", "Pharmaceuticals, Conditions, and Symptoms"],
];

const SENSITIVE_LABEL =
  /\b(diabet\w*|cancer\w*|hiv|aids|pregnan\w*|fertility|ivf|depress\w*|anxiety|mental health|disease\w*|illness\w*|medical conditions?|addiction|rehab|abortion|religio\w*|muslim\w*|hindu\w*|christian\w*|sikh\w*|jewish|islam\w*|caste|ethnic\w*|sexual\w*|lgbt\w*|gay|lesbian|transgender|minors?|child(ren)?|kids?|teen\w*|trade unions?|criminal record\w*)\b/i;

export function isSensitiveNode(node: Pick<TaxonomyNode, "path">): boolean {
  return SENSITIVE_PATH_PREFIXES.some((prefix) => prefix.every((name, i) => node.path[i] === name));
}

export function isSensitiveLabel(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && SENSITIVE_LABEL.test(t));
}
