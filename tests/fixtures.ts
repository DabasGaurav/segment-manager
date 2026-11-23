/** Synthetic OpenRTB 2.6 bid requests used across tests. All publishers are fictional. */
export function bidRequest(over: { site?: unknown; app?: unknown; user?: unknown; regs?: unknown; device?: unknown } = {}) {
  return {
    id: "req-nexon-1",
    imp: [{ id: "1", banner: { w: 300, h: 250 } }],
    site: over.site ?? { domain: "drivedesk.example", page: "https://drivedesk.example/reviews/tata-nexon-ev" },
    ...(over.app !== undefined ? { app: over.app } : {}),
    ...(over.user !== undefined ? { user: over.user } : {}),
    device: over.device ?? { geo: { country: "DEU" } },
    regs: over.regs ?? { gdpr: 1, coppa: 0 },
  };
}

export const contentData = (data: unknown[]) => ({ domain: "drivedesk.example", content: { data } });
