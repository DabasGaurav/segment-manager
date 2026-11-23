"use client";
import { useState } from "react";
import { OPS, REVIEWER, useApp, type View } from "./App";
import { api, type Json } from "./client";
import { decide, importDictionary } from "./views/Review";
import { activateVersion, publishVersion, saveGrant } from "./views/Publish";

interface Step {
  key: string;
  title: string;
  who?: { persona: string; label: string };
  why: string;
  view: View;
  done: boolean;
}

export function GuidedDemo() {
  const app = useApp();
  const { data, persona, switchTo, act, go, setDemoOpen, seenScenarios, setReader, setDsp, busy } = app;
  const [started, setStarted] = useState(data.proposals.length > 0);
  const [triedOverride, setTriedOverride] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const p = (raw: string) => data.proposals.find((x) => x.raw_id === raw && x.status !== "SUPERSEDED");
  const approved = (raw: string) => p(raw)?.status === "APPROVED";
  const grantOk = data.grant && data.grant.level !== "G0" && (data.grant.dsp_allowlist ?? []).includes("ttd");
  const live = data.activeVersion !== null;

  const steps: Step[] = [
    { key: "import", title: "Import DriveDesk's signals", who: { persona: OPS, label: "Publisher ops" }, view: "review", done: data.proposals.length > 0,
      why: "DriveDesk sends private IDs like ev_research. Importing its dictionary tells us what each one means and creates a suggested IAB category for each." },
    { key: "review", title: "Review the suggestions", who: { persona: REVIEWER, label: "Reviewer" }, view: "review", done: approved("ev-news") && approved("ev_research") && approved("ev_intent"),
      why: "Only exact matches are approved automatically (Sedans). A person decides the rest. Sensitive topics are blocked for good." },
    { key: "grant", title: "Choose which buyers may receive them", who: { persona: OPS, label: "Publisher ops" }, view: "publish", done: !!grantOk,
      why: "The publisher stays in control: translated signals go only to the buyers they list." },
    { key: "publish", title: "Publish and make it live", who: { persona: REVIEWER, label: "Reviewer" }, view: "publish", done: live,
      why: "Publishing freezes the approved mappings into a fingerprinted version. The bidder only ever uses the live version." },
    { key: "verify", title: "See what the buyer receives", view: "verify", done: seenScenarios.has("eu-consented|ttd") && seenScenarios.has("eu-no-profiles|ttd") && [...seenScenarios].some((s) => s.endsWith("|xandr")),
      why: "The real resolver runs on the Tata Nexon EV request. Change the reader's consent or the buyer and watch the result change." },
  ];
  const current = steps.find((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  async function as(who: Step["who"]) {
    if (who && persona?.persona !== who.persona) {
      setMsg(`Switched to DriveDesk ${who.label.toLowerCase()}: only this role can do the next step.`);
      return switchTo(who.persona);
    }
    setMsg(null);
    return true;
  }

  async function start() {
    setMsg(null);
    await act("Sample data reset. The demo starts from a clean DriveDesk workspace.", () => api("/v1/demo/reset", { method: "POST" }));
    await switchTo(OPS);
    setTriedOverride(false);
    setReader("eu-consented");
    setDsp("ttd");
    setStarted(true);
    go("review");
  }

  async function doStep(s: Step) {
    if (!(await as(s.who))) return;
    go(s.view);
    if (s.key === "import") await act("Imported DriveDesk's dictionary.", importDictionary, OPS);
    if (s.key === "grant") await act("Permissions saved: translate for ttd; unmapped IDs removed.", () => saveGrant(["ttd"], "drop"), OPS);
    if (s.key === "publish")
      await act("Published and made live.", async () => {
        const r = await publishVersion();
        return r.ok ? activateVersion(r.data.version) : r;
      }, REVIEWER);
  }

  async function decideRaw(raw: string, body: Json, label: string) {
    const prop = p(raw);
    if (!prop || !(await as({ persona: REVIEWER, label: "Reviewer" }))) return;
    go("review");
    // re-read after a possible role switch so row_version is current
    const fresh = await api(`/v1/publishers/pub_drivedesk/proposals`);
    const row = fresh.ok ? (fresh.data.proposals as Json[]).find((x) => x.id === prop.id) ?? prop : prop;
    await act(label, () => decide(row, body), REVIEWER);
  }

  function scenario(reader: "eu-consented" | "eu-no-profiles" | "india", dsp: string) {
    setReader(reader);
    setDsp(dsp);
    go("verify");
  }

  return (
    <aside className="demo" aria-label="Guided demo">
      <div className="demo-head">
        <div>
          <div className="eyebrow">Guided demo</div>
          <strong>Make DriveDesk&apos;s EV signals usable</strong>
        </div>
        <button className="icon-btn" aria-label="Close guide" onClick={() => setDemoOpen(false)}>×</button>
      </div>
      <div className="progress" aria-label={`${doneCount} of ${steps.length} steps done`}>
        <div style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      {!started ? (
        <div className="demo-body">
          <p>
            You&apos;ll onboard <strong>DriveDesk</strong>, a car-review site, and follow one ad request from its Tata Nexon EV review to a buyer.
            Five steps, about two minutes.
          </p>
          <ul className="small plain">
            <li>✓ Every action calls the real API</li>
            <li>✓ Roles switch as needed; the server checks each one</li>
            <li>✓ Publishers and readers are synthetic</li>
          </ul>
          <button className="btn primary block" onClick={start} disabled={busy}>Start with clean sample data</button>
          <button className="link-btn small" onClick={() => setStarted(true)}>Continue with the current data</button>
        </div>
      ) : (
        <div className="demo-body">
          {msg && <div className="callout info small">{msg}</div>}
          <ol className="demo-steps">
            {steps.map((s, i) => {
              const isCur = current?.key === s.key;
              return (
                <li key={s.key} className={s.done ? "done" : isCur ? "current" : ""}>
                  <button className="demo-step-title" onClick={() => go(s.view)}>
                    <span className="step-dot">{s.done ? "✓" : i + 1}</span>
                    <span>{s.title}</span>
                  </button>
                  {isCur && (
                    <div className="demo-step-body">
                      {s.who && <div className="who">Done by: <strong>{s.who.label}</strong>{persona?.persona === s.who.persona ? " (you)" : ""}</div>}
                      <p className="small">{s.why}</p>
                      {s.key === "import" && <button className="btn primary small" onClick={() => doStep(s)} disabled={busy}>Import the dictionary</button>}
                      {s.key === "review" && (
                        <div className="tasks">
                          <Task done={approved("auto_sedans")} label="Sedans was approved automatically (exact match)" />
                          <Task done={approved("ev-news")} label="EV news → Green Vehicles (broader: IAB has no EV category)" action="Approve" onClick={() => decideRaw("ev-news", { action: "approve" }, "Approved EV news → Green Vehicles.")} />
                          <Task done={approved("ev_research")} label="EV researchers → Green Vehicles (reader interest)" action="Approve" onClick={() => decideRaw("ev_research", { action: "approve" }, "Approved EV researchers → Green Vehicles.")} />
                          <Task done={approved("ev_intent")} label="EV intenders claims purchase intent, but comes from reading articles" action="Reclassify as interest"
                            onClick={() => decideRaw("ev_intent", { action: "choose_other", target: { segtax: 4, id: "253" }, reclassify_to: "AUDIENCE_INTEREST", note: "Reading behaviour shows interest, not purchase intent" }, "EV intenders reclassified as interest → Green Vehicles.")} />
                          <Task done={triedOverride} optional label="Diabetes care readers is blocked as sensitive. Try to override it" action="Try it"
                            onClick={async () => { setTriedOverride(true); await decideRaw("hlth_diab", { action: "approve" }, ""); }} />
                        </div>
                      )}
                      {s.key === "grant" && <button className="btn primary small" onClick={() => doStep(s)} disabled={busy}>Allow ttd, remove unmapped IDs</button>}
                      {s.key === "publish" && <button className="btn primary small" onClick={() => doStep(s)} disabled={busy}>Publish and make live</button>}
                      {s.key === "verify" && (
                        <div className="tasks">
                          <Task done={seenScenarios.has("eu-consented|ttd")} label="German reader who agreed to personalised ads, buyer ttd" action="Show" onClick={() => scenario("eu-consented", "ttd")} />
                          <Task done={seenScenarios.has("eu-no-profiles|ttd")} label="Same reader, but declined profile-based ads" action="Show" onClick={() => scenario("eu-no-profiles", "ttd")} />
                          <Task done={[...seenScenarios].some((x) => x.endsWith("|xandr"))} label="A buyer DriveDesk hasn't allowed (xandr)" action="Show" onClick={() => scenario("eu-consented", "xandr")} />
                        </div>
                      )}
                      {s.key !== "verify" && s.key !== "review" && <div className="muted small">Or do it yourself on the page.</div>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {!current && (
            <div className="demo-done">
              <h3>Done: DriveDesk&apos;s signals are live</h3>
              <p className="small">
                Its private IDs now reach allowed buyers as standard IAB categories. The health segment never leaves, and each reader&apos;s consent is
                respected. Every step is in the activity log.
              </p>
              <div className="stack-sm">
                <button className="btn small" onClick={() => go("publish")}>Try a rollback (Configure & publish)</button>
                <button className="btn small" onClick={() => go("activity")}>See the activity log</button>
                <button className="btn small" onClick={() => go("developer")}>Explore the API & technical details</button>
                <button className="link-btn small" onClick={start}>Restart the demo</button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function Task({ done, label, action, onClick, optional }: { done: boolean; label: string; action?: string; onClick?: () => void; optional?: boolean }) {
  const { busy } = useApp();
  return (
    <div className={`task ${done ? "done" : ""}`}>
      <span className="tick" aria-hidden>{done ? "✓" : "○"}</span>
      <span className="small">{label}{optional && <span className="muted"> (optional)</span>}</span>
      {!done && action && onClick && <button className="btn small" onClick={onClick} disabled={busy}>{action}</button>}
    </div>
  );
}
