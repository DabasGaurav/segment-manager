"use client";
import { useApp, Tag } from "../App";

export function Overview() {
  const { data, go, setDemoOpen, loaded } = useApp();
  const total = data.proposals.filter((p) => !["SUPERSEDED"].includes(p.status)).length;
  const pending = data.proposals.filter((p) => p.status === "PENDING_REVIEW").length;
  const approved = data.proposals.filter((p) => p.status === "APPROVED").length;
  const blocked = data.proposals.filter((p) => p.status === "BLOCKED").length;
  const live = data.versions.find((v) => v.active);
  const buyers: string[] = data.grant?.dsp_allowlist ?? [];
  const onboarded = data.grant && data.grant.level !== "G0";

  const stages = [
    {
      n: 1,
      view: "review" as const,
      title: "Import & review",
      what: "Bring in the publisher's own signal list. The system suggests an official IAB category for each one, and a reviewer approves it.",
      status: !loaded ? "Loading…" : total === 0 ? "Not started" : pending > 0 ? `${pending} need${pending === 1 ? "s" : ""} review · ${approved} approved` : `${approved} approved · ${blocked} blocked`,
      tone: total === 0 ? "muted" : pending > 0 ? "warn" : "ok",
      cta: total === 0 ? "Import signals" : pending > 0 ? "Review now" : "Open",
    },
    {
      n: 2,
      view: "publish" as const,
      title: "Configure & publish",
      what: "Choose which buyers may receive translated signals, then publish the approved mappings as a frozen version you can roll back.",
      status: !loaded ? "Loading…" : live ? `Version ${live.version} live · buyers: ${buyers.join(", ") || "none"}` : onboarded ? "Permissions set · nothing published" : "Not configured",
      tone: live ? "ok" : onboarded ? "warn" : "muted",
      cta: live ? "Open" : "Configure",
    },
    {
      n: 3,
      view: "verify" as const,
      title: "Verify results",
      what: "Send a real bid request through the resolver and see, signal by signal, what the buyer receives and why.",
      status: live ? "Ready to verify" : "Works now; translation starts once a version is live",
      tone: live ? "ok" : "muted",
      cta: "Verify",
    },
  ];

  return (
    <div className="stack-lg">
      <section className="hero">
        <div>
          <div className="eyebrow">Internal tool · Media.net supply</div>
          <h1>Make publishers&apos; targeting signals usable by buyers, safely.</h1>
          <p className="lead">
            Publishers attach labels like <em>&quot;EV researchers&quot;</em> to ad requests, often as private IDs buyers can&apos;t read.
            Segment Manager passes standard IAB signals through, translates a publisher&apos;s own IDs only through human-approved mappings,
            and removes anything sensitive, unconsented or not permitted. Every decision has a reason.
          </p>
          <div className="row">
            <button className="btn primary lg" onClick={() => { setDemoOpen(true); }}>Start guided demo</button>
            <button className="btn lg" onClick={() => go(total === 0 ? "review" : pending > 0 ? "review" : live ? "verify" : "publish")}>Explore on my own</button>
          </div>
          <p className="muted small">About 2 minutes. Uses the DriveDesk scenario: a Tata Nexon EV review page.</p>
        </div>
        <div className="outcomes" aria-label="The four possible outcomes">
          <div className="outcome-card ok"><strong>Passed through</strong><span>Already a valid IAB category. Sent unchanged.</span></div>
          <div className="outcome-card ok"><strong>Translated</strong><span>Publisher&apos;s ID replaced by its approved IAB category.</span></div>
          <div className="outcome-card warn"><strong>Kept as sent</strong><span>Left untouched: not onboarded, or the publisher chose to.</span></div>
          <div className="outcome-card bad"><strong>Removed</strong><span>Sensitive, unconsented, not permitted or invalid.</span></div>
        </div>
      </section>

      <section>
        <h2 className="section-title">DriveDesk&apos;s onboarding</h2>
        <div className="stages">
          {stages.map((s) => (
            <button key={s.n} className="stage-card" onClick={() => go(s.view)}>
              <div className="stage-top">
                <span className="stage-n">{s.n}</span>
                <Tag tone={s.tone}>{s.status}</Tag>
              </div>
              <h3>{s.title}</h3>
              <p className="muted">{s.what}</p>
              <span className="link">{s.cta} →</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card subtle">
        <h2 className="section-title">What&apos;s real here</h2>
        <div className="legend">
          <div><Tag tone="real">Real</Tag> Official IAB taxonomy files (checksum-verified), OpenRTB parsing, consent-string decoding, the mapping engine, database, roles and audit log. Every button calls the real API.</div>
          <div><Tag tone="synthetic">Synthetic</Tag> The publishers (DriveDesk, Metro Daily), their signals, the people and the bid requests are invented for the demo.</div>
          <div><Tag tone="illustrative">Illustrative</Tag> The consent and sensitive-topic rules are written from public IAB specs. They are not legal advice and not Media.net policy.</div>
        </div>
      </section>
    </div>
  );
}
