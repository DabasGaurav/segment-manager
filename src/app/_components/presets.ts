/** Synthetic sample bid requests for the Detection Lab. Publishers and pages are fictional. */
const base = (site: object, user?: object) => ({
  id: "req-nexon-1",
  imp: [{ id: "1", banner: { w: 300, h: 250 } }],
  site: { domain: "drivedesk.example", page: "https://drivedesk.example/reviews/tata-nexon-ev", ...site },
  ...(user ? { user } : {}),
  device: { geo: { country: "DEU" } },
  regs: { gdpr: 1, coppa: 0 },
});

export const PRESETS: { key: string; label: string; body: object }[] = [
  {
    key: "metro-valid",
    label: "Metro Daily: already-valid IAB audience IDs (one bad ID)",
    body: {
      publisher_id: "pub_metrodaily",
      dsp: "ttd",
      bid_request: base(
        { domain: "metrodaily.example", page: "https://metrodaily.example/auto/nexon-ev-review" },
        { data: [{ name: "metrodaily.example", ext: { segtax: 4 }, segment: [{ id: "253" }, { id: "99999" }] }] },
      ),
    },
  },
  {
    key: "drivedesk-proprietary",
    label: "DriveDesk: proprietary IDs with no segtax",
    body: {
      publisher_id: "pub_drivedesk",
      dsp: "ttd",
      bid_request: base(
        { content: { data: [{ name: "drivedesk.example", segment: [{ id: "ev-news" }, { id: "seg_4471" }] }] } },
        { data: [{ name: "drivedesk.example", segment: [{ id: "ev_research" }, { id: "ev_intent" }] }] },
      ),
    },
  },
  {
    key: "misplaced",
    label: "Wrong place or retired taxonomy: audience IDs in content, Content 2.0, Ad Product",
    body: {
      publisher_id: "pub_drivedesk",
      dsp: "ttd",
      bid_request: base({
        content: {
          data: [
            { name: "drivedesk.example", ext: { segtax: 4 }, segment: [{ id: "253" }] },
            { name: "legacy.example", ext: { segtax: 2 }, segment: [{ id: "IAB2" }] },
            { name: "adproduct.example", ext: { segtax: 8 }, segment: [{ id: "1" }] },
          ],
        },
      }),
    },
  },
  {
    key: "nonstandard",
    label: "segtax in the wrong field (treated as proprietary)",
    body: {
      publisher_id: "pub_drivedesk",
      dsp: "ttd",
      bid_request: base({ content: { data: [{ name: "drivedesk.example", segment: [{ id: "22", ext: { segtax: 7 } }] }] } }),
    },
  },
  {
    key: "versions",
    label: "Same provider, Content 2.2 and 3.1 in separate objects (allowed)",
    body: {
      publisher_id: "pub_metrodaily",
      dsp: "ttd",
      bid_request: base({
        domain: "metrodaily.example",
        content: {
          data: [
            { name: "metrodaily.example", ext: { segtax: 6 }, segment: [{ id: "22" }] },
            { name: "metrodaily.example", ext: { segtax: 9 }, segment: [{ id: "22" }, { id: "80DV8O" }] },
          ],
        },
      }),
    },
  },
];
