/** Synthetic DriveDesk India dictionary and samples used by the demo, the UI and the tests. */
export const DRIVEDESK_DICTIONARY = [
  { raw_id: "ev-news", field: "content", label: "EV news", description: "Articles about electric vehicles such as the Tata Nexon EV", declared_class: "CONTENT_TOPIC", declared_source: "editorial" },
  { raw_id: "auto_sedans", field: "content", label: "Sedans", description: "Sedan reviews and comparisons", declared_class: "CONTENT_TOPIC", declared_source: "editorial" },
  { raw_id: "ev_research", field: "user", label: "EV researchers", description: "Readers who researched electric cars in the last 30 days", declared_class: "AUDIENCE_INTEREST", declared_source: "reading_behaviour" },
  { raw_id: "ev_intent", field: "user", label: "EV intenders", description: "Readers likely to buy an electric car soon", declared_class: "PURCHASE_INTENT", declared_source: "reading_behaviour" },
  { raw_id: "hlth_diab", field: "user", label: "Diabetes care readers", description: "Readers of diabetes management articles", declared_class: "AUDIENCE_INTEREST", declared_source: "reading_behaviour" },
] as const;

export const DRIVEDESK_SAMPLE = {
  id: "sample-1",
  imp: [{ id: "1", banner: { w: 300, h: 250 } }],
  site: {
    domain: "drivedesk.example",
    page: "https://drivedesk.example/reviews/tata-nexon-ev",
    content: { data: [{ name: "drivedesk.example", segment: [{ id: "ev-news" }, { id: "seg_4471" }] }] },
  },
  user: { data: [{ name: "drivedesk.example", segment: [{ id: "ev_research" }, { id: "ev_intent" }] }] },
};

/** SYNTHETIC TCF v2 strings made with the official IAB encoder (see src/lib/policy/tcf-builder.ts). */
export const TC_FULL_CONSENT = "CQuIxQAQuIxQAACABAENABFgAPAAAEIAAAYgBHQAQBHAEdABAEcAAAAA.IBHQAQBHAAAA";
export const TC_NO_PROFILES = "CQuIxQAQuIxQAACABAENABFgAMAAAEIAAAYgBHQAQBHAEdABAEcAAAAA.IBHQAQBHAAAA";

/** The Tata Nexon EV review page, as seen by three different readers. */
export function nexonRequest(reader: "eu-consented" | "eu-no-profiles" | "india", extra: { user?: Record<string, unknown> } = {}) {
  const userData = [
    { name: "drivedesk.example", segment: [{ id: "ev_research" }, { id: "ev_intent" }, { id: "hlth_diab" }] },
    { name: "metrodaily.example", ext: { segtax: 4 }, segment: [{ id: "253" }, { id: "99999" }] },
  ];
  const consent = reader === "eu-consented" ? TC_FULL_CONSENT : reader === "eu-no-profiles" ? TC_NO_PROFILES : undefined;
  return {
    id: `req-nexon-${reader}`,
    imp: [{ id: "1", banner: { w: 300, h: 250 } }],
    site: {
      domain: "drivedesk.example",
      page: "https://drivedesk.example/reviews/tata-nexon-ev",
      content: { data: [{ name: "drivedesk.example", segment: [{ id: "ev-news" }, { id: "seg_4471" }] }] },
    },
    user: { ...(consent ? { consent } : {}), data: userData, ...(extra.user ?? {}) },
    device: { geo: { country: reader === "india" ? "IND" : "DEU" } },
    regs: reader === "india" ? { gdpr: 0, coppa: 0 } : { gdpr: 1, coppa: 0 },
  };
}
