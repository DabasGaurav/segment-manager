/** Plain-English wording for statuses and reason codes. The codes themselves stay visible in technical details. */

export const OUTCOME: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info"; verb: string }> = {
  PASSED_THROUGH: { label: "Passed through", tone: "ok", verb: "Already standard, sent unchanged" },
  TRANSLATED: { label: "Translated", tone: "ok", verb: "Replaced with the IAB category" },
  KEPT_RAW: { label: "Kept as sent", tone: "warn", verb: "Sent unchanged" },
  REMOVED: { label: "Removed", tone: "bad", verb: "Not sent to the buyer" },
};

export const PROPOSAL_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "muted" }> = {
  PENDING_REVIEW: { label: "Needs review", tone: "warn" },
  APPROVED: { label: "Approved", tone: "ok" },
  BLOCKED: { label: "Blocked", tone: "bad" },
  ABSTAINED: { label: "Left unmapped", tone: "muted" },
  REVOKED: { label: "Revoked", tone: "muted" },
  REJECTED: { label: "Rejected", tone: "muted" },
  SUPERSEDED: { label: "Replaced by a newer import", tone: "muted" },
};

export const SIGNAL_CLASS: Record<string, string> = {
  CONTENT_TOPIC: "Page topic",
  AUDIENCE_INTEREST: "Reader interest",
  PURCHASE_INTENT: "Purchase intent",
  DEMOGRAPHIC: "Demographic",
};

export const MATCH: Record<string, { label: string; tone: "ok" | "warn" | "info" }> = {
  exact: { label: "Exact match", tone: "ok" },
  broader: { label: "Broader match", tone: "warn" },
  candidate: { label: "Suggestion", tone: "info" },
  reviewer_selected: { label: "Chosen by reviewer", tone: "info" },
};

const CODE_TEXT: Record<string, string> = {
  // mapping
  EXACT_MATCH: "The label matches an official IAB category exactly, so it was approved automatically.",
  LOSSY_BROADER_MATCH: "IAB has no exact category for this, so it maps to the closest broader one.",
  LEXICAL_CANDIDATE: "Suggested from overlapping words. A reviewer must confirm it.",
  ABSTAIN_AMBIGUOUS: "Several IAB categories fit equally well, so a reviewer has to choose.",
  ABSTAIN_INSUFFICIENT: "There isn't enough information to suggest a category.",
  NO_DICTIONARY_ENTRY: "Seen in the publisher's traffic but missing from their dictionary.",
  PROMOTION_REVIEW_REQUIRED: "Purchase intent is never approved automatically.",
  INTENT_SOURCE_NOT_DECLARED: "The publisher didn't name a purchase-type source, such as a transaction or test-drive booking.",
  PROMOTION_REJECTED: "Declared as purchase intent, but it came from reading behaviour, so it's treated as interest.",
  REVIEWER_APPROVED: "Approved by a reviewer.",
  SENSITIVE_CATEGORY: "Sensitive topic (health, religion, sexuality or children). It is never sent to buyers and can't be overridden.",
  CLASS_NOT_SUPPORTED: "This kind of signal isn't supported yet.",
  CROSS_VERSION_SAME_ID_AND_NAME: "The publisher declared an equivalent IAB ID with the same name.",
  // resolve
  VALID_STANDARD: "It already uses a valid IAB category, so it passes through unchanged.",
  APPROVED_MAPPING: "Translated using the approved mapping.",
  NO_APPROVED_MAPPING: "There's no approved mapping for this ID in the live version.",
  UNMAPPED_DROP_PER_PUBLISHER: "The publisher chose to remove signals without a mapping.",
  UNMAPPED_PASS_RAW_PER_PUBLISHER: "The publisher chose to pass unmapped signals on unchanged.",
  GRANT_NOT_ALLOWED_FOR_DSP: "The publisher hasn't allowed this buyer to receive translated signals.",
  PUBLISHER_NOT_ONBOARDED: "This publisher isn't onboarded yet, so its own IDs are left untouched.",
  THIRD_PARTY_PROVIDER_NOT_TRANSLATED: "This ID belongs to another data provider, so this publisher's mappings never apply.",
  SEGTAX_ID_NOT_IN_TAXONOMY: "This ID doesn't exist in the IAB list it claims to use.",
  DUPLICATE_SEGMENT: "A repeat of an ID already in the request.",
  INTERNAL_FAIL_CLOSED: "An internal error occurred, so everything was removed to stay safe.",
  MALFORMED_DATA_OBJECT: "The data block was malformed.",
  // consent
  TCF_ALLOWED: "The reader's consent allows this use.",
  TCF_STRING_MISSING: "No consent string was sent for a reader covered by GDPR.",
  TCF_STRING_INVALID: "The consent string couldn't be read.",
  PURPOSE_CONSENT_MISSING: "The reader didn't consent to profile-based advertising.",
  VENDOR_CONSENT_MISSING: "The reader didn't consent to Media.net (vendor 142).",
  VENDOR_NOT_DISCLOSED: "Media.net wasn't shown to the reader in the consent banner.",
  NO_SUPPORTED_CONSENT_FRAMEWORK: "No supported consent signal exists for this country yet, so reader-profile data is removed (illustrative rule).",
  JURISDICTION_RULE_ALLOW_ILLUSTRATIVE: "Page topics are allowed for this country (illustrative rule).",
  GPP_NOT_SUPPORTED: "US privacy strings aren't supported yet, so reader-profile data is removed.",
  CHILD_DIRECTED_BLOCK: "The page is child-directed, so reader-profile data is never sent.",
  UNKNOWN_JURISDICTION: "The reader's country is unknown, so the safe default is to remove.",
  JURISDICTION_NOT_CONFIGURED: "No rules are configured for this country, so the safe default is to remove.",
};

/** Order of importance when choosing the one-line explanation. */
const PRIORITY = [
  "SENSITIVE_CATEGORY", "INTERNAL_FAIL_CLOSED", "GRANT_NOT_ALLOWED_FOR_DSP", "SEGTAX_ID_NOT_IN_TAXONOMY", "PURPOSE_CONSENT_MISSING",
  "VENDOR_CONSENT_MISSING", "VENDOR_NOT_DISCLOSED", "TCF_STRING_MISSING", "TCF_STRING_INVALID", "NO_SUPPORTED_CONSENT_FRAMEWORK", "GPP_NOT_SUPPORTED",
  "CHILD_DIRECTED_BLOCK", "UNKNOWN_JURISDICTION", "JURISDICTION_NOT_CONFIGURED", "PUBLISHER_NOT_ONBOARDED", "THIRD_PARTY_PROVIDER_NOT_TRANSLATED",
  "UNMAPPED_DROP_PER_PUBLISHER", "UNMAPPED_PASS_RAW_PER_PUBLISHER", "PROMOTION_REJECTED", "LOSSY_BROADER_MATCH", "EXACT_MATCH", "VALID_STANDARD",
  "APPROVED_MAPPING", "ABSTAIN_AMBIGUOUS", "ABSTAIN_INSUFFICIENT", "NO_DICTIONARY_ENTRY", "PROMOTION_REVIEW_REQUIRED", "LEXICAL_CANDIDATE",
  "DUPLICATE_SEGMENT", "TCF_ALLOWED",
];

export function explain(code: string): string | null {
  return CODE_TEXT[code] ?? null;
}

/** The single most important sentence, plus any secondary ones. */
export function explainCodes(codes: string[]): { main: string; more: string[] } {
  const known = codes.filter((c) => CODE_TEXT[c]);
  const sorted = [...known].sort((a, b) => (PRIORITY.indexOf(a) + 1 || 999) - (PRIORITY.indexOf(b) + 1 || 999));
  const main = sorted[0] ? CODE_TEXT[sorted[0]]! : codes.length ? "See the technical details." : "";
  return { main, more: sorted.slice(1).map((c) => CODE_TEXT[c]!) };
}

export const READERS = [
  { key: "eu-consented", label: "Germany", sub: "Agreed to personalised ads" },
  { key: "eu-no-profiles", label: "Germany", sub: "Declined profile-based ads" },
  { key: "india", label: "India", sub: "No consent framework" },
] as const;
export type ReaderKey = (typeof READERS)[number]["key"];

export const BUYERS = [
  { key: "ttd", label: "ttd" },
  { key: "xandr", label: "xandr" },
] as const;
