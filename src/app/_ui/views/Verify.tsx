"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, PID, Tag, useApp } from "../App";
import { api, type Json } from "../client";
import { BUYERS, explainCodes, OUTCOME, READERS, type ReaderKey } from "../explain";
import { DRIVEDESK_DICTIONARY, nexonRequest } from "@/lib/demo/dictionary";
import { NodeName } from "./Review";

const MEANING: Record<string, string> = Object.fromEntries(DRIVEDESK_DICTIONARY.map((d) => [d.raw_id, d.label]));

export function runResolve(reader: ReaderKey, dsp: string) {
  return api("/api/lab/resolve", { method: "POST", body: { publisher_id: PID, dsp, bid_request: nexonRequest(reader) } });
}

export function VerifyView() {
  const { reader, setReader, dsp, setDsp, lastResolve, setLastResolve, markScenario, data, go } = useApp();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState<string>("");
  const [tech, setTech] = useState(false);
  const seq = useRef(0);

  const run = useCallback(async () => {
    const my = ++seq.current;
    setState("loading");
    const r = await runResolve(reader, dsp);
    if (my !== seq.current) return;
    if (r.ok) {
      setLastResolve({ ...r.data, _reader: reader, _dsp: dsp });
      markScenario(`${reader}|${dsp}`);
      setState("idle");
    } else {
      setErr(r.status === 401 ? "Pick a role in the top bar to run checks." : `${r.data.detail ?? "The check failed."}${r.data.code ? ` (${r.data.code})` : ""}`);
      setState("error");
    }
    // markScenario is stable enough for this purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, dsp, setLastResolve]);

  useEffect(() => {
    run();
  }, [run]);

  const res = lastResolve && lastResolve._reader === reader && lastResolve._dsp === dsp ? lastResolve : null;
  const decisions: Json[] = res?.decisions ?? [];
  const sent = decisions.filter((d) => d.outcome === "TRANSLATED" || d.outcome === "PASSED_THROUGH" || d.outcome === "KEPT_RAW").length;
  const groups = [
    { title: "About the page (content signals)", items: decisions.filter((d) => String(d.path).startsWith("site")) },
    { title: "About the reader (audience signals)", items: decisions.filter((d) => String(d.path).startsWith("user")) },
  ];

  return (
    <div className="stack">
      <PageHeader
        step="Step 3 of 3"
        title="Verify results"
        lead="A reader opens DriveDesk's Tata Nexon EV review. The ad request carries DriveDesk's own IDs plus Metro Daily's standard IAB IDs. Choose the reader and the buyer: the real resolver decides what the buyer receives."
      />

      <section className="card scenario">
        <div className="scenario-group">
          <div className="label">Reader</div>
          <div className="segmented" role="radiogroup" aria-label="Reader">
            {READERS.map((r) => (
              <button key={r.key} role="radio" aria-checked={reader === r.key} className={reader === r.key ? "on" : ""} onClick={() => setReader(r.key)}>
                <strong>{r.label}</strong>
                <span>{r.sub}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="scenario-group">
          <div className="label">Buyer (DSP)</div>
          <div className="segmented" role="radiogroup" aria-label="Buyer">
            {BUYERS.map((b) => {
              const allowed = (data.grant?.dsp_allowlist ?? []).includes(b.key);
              return (
                <button key={b.key} role="radio" aria-checked={dsp === b.key} className={dsp === b.key ? "on" : ""} onClick={() => setDsp(b.key)}>
                  <strong>{b.label}</strong>
                  <span>{allowed ? "Allowed by DriveDesk" : "Not on DriveDesk's list"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {data.activeVersion === null && (
        <div className="callout info">
          DriveDesk has no live version yet, so its own IDs can&apos;t be translated. Standard IAB signals are still checked.{" "}
          <button className="link-btn" onClick={() => go(data.proposals.length ? "publish" : "review")}>Finish onboarding →</button>
        </div>
      )}

      {state === "error" && <div className="notice bad" role="alert">{err} <button className="btn small" onClick={run}>Retry</button></div>}

      <section className="card" aria-busy={state === "loading"}>
        {!res ? (
          <div className="skeleton">Running the real resolver…</div>
        ) : (
          <>
            <div className="result-head">
              <div>
                <h2>
                  {sent} of {decisions.length} signals reach <span className="accent">{dsp}</span>
                </h2>
                <p className="muted">
                  {res.summary.TRANSLATED} translated · {res.summary.PASSED_THROUGH} passed through · {res.summary.KEPT_RAW} kept as sent · {res.summary.REMOVED} removed
                  {res.mapping_version ? ` · using version ${String(res.mapping_version).split("@")[1]}` : " · no live version"}
                </p>
              </div>
              <div className="policy">
                <div className="small muted">Privacy check · {res.policy?.jurisdiction}</div>
                <div className="row">
                  <Tag tone={res.policy?.content.allowed ? "ok" : "bad"}>Page topics {res.policy?.content.allowed ? "allowed" : "blocked"}</Tag>
                  <Tag tone={res.policy?.audience.allowed ? "ok" : "bad"}>Reader profiles {res.policy?.audience.allowed ? "allowed" : "blocked"}</Tag>
                </div>
              </div>
            </div>
            {res.status === "DEGRADED" && <div className="notice bad">The resolver hit an internal error and removed everything to stay safe.</div>}

            {groups.map((g) => (
              <div key={g.title} className="ba-group">
                <h3>{g.title}</h3>
                <div className="ba-head" aria-hidden>
                  <span>Signal the publisher sent</span>
                  <span></span>
                  <span>What the buyer receives</span>
                  <span>Why</span>
                </div>
                {g.items.map((d) => (
                  <DecisionRow key={d.path} d={d} />
                ))}
              </div>
            ))}

            <p className="muted small">
              Try it: switch the reader to <em>declined profile-based ads</em>, and the reader signals disappear while page topics stay. Switch the buyer to{" "}
              <em>xandr</em>, and DriveDesk&apos;s translated signals are removed, because DriveDesk hasn&apos;t allowed that buyer.
            </p>

            <button className="link-btn" onClick={() => setTech(!tech)} aria-expanded={tech}>{tech ? "Hide technical details" : "Show technical details (request, response, API call)"}</button>
            {tech && (
              <div className="tech">
                <div className="grid2">
                  <div>
                    <h4>Segments sent in (OpenRTB)</h4>
                    <pre>{JSON.stringify(pick(nexonRequest(reader)), null, 2)}</pre>
                  </div>
                  <div>
                    <h4>Segments forwarded to {dsp}</h4>
                    <pre>{JSON.stringify(pick(res.bid_request), null, 2)}</pre>
                  </div>
                </div>
                <h4>Full resolver response</h4>
                <pre className="tall">{JSON.stringify(strip(res), null, 2)}</pre>
                <h4>The same call from a bidder service</h4>
                <pre>{`curl -X POST https://segment-manager.vercel.app/v1/resolve \\
  -H "Authorization: Bearer <service key>" -H "Content-Type: application/json" \\
  -d '{"publisher_id":"${PID}","dsp":"${dsp}","bid_request":{…}}'`}</pre>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function DecisionRow({ d }: { d: Json }) {
  const o = OUTCOME[d.outcome] ?? { label: d.outcome, tone: "muted", verb: "" };
  const own = d.provider === "drivedesk.example";
  const ex = explainCodes(d.reason_codes ?? []);
  const isStd = !own && /^\d+$/.test(String(d.raw_id));
  return (
    <div className={`ba-row ${o.tone}`}>
      <div className="ba-from">
        <div className="sig-label">
          {own ? MEANING[d.raw_id] ?? "Unknown DriveDesk ID" : isStd ? <NodeName segtax={4} id={String(d.raw_id)} /> : d.raw_id}
        </div>
        <div className="muted small">
          <code>{d.raw_id}</code> · {own ? "DriveDesk's own ID" : `${d.provider} · standard IAB ID`}
        </div>
      </div>
      <div className="ba-arrow" aria-hidden>→</div>
      <div className="ba-to">
        {d.outcome === "REMOVED" ? (
          <span className="removed">Not sent</span>
        ) : d.to ? (
          <>
            <div className="sig-label">{d.to.name}</div>
            <div className="muted small">IAB ID {d.to.id} · {d.to.segtax === 4 ? "Audience 1.1" : "Content 3.0"}</div>
          </>
        ) : (
          <>
            <div className="sig-label">{isStd ? <NodeName segtax={4} id={String(d.raw_id)} /> : <code>{d.raw_id}</code>}</div>
            <div className="muted small">Unchanged</div>
          </>
        )}
        <Tag tone={o.tone}>{o.label}</Tag>
      </div>
      <div className="ba-why">
        {ex.main}
        <details className="small">
          <summary>Codes</summary>
          {(d.reason_codes ?? []).map((c: string) => <code key={c} className="code-chip">{c}</code>)}
          <div className="muted">{d.path}</div>
        </details>
      </div>
    </div>
  );
}

function pick(br: Json) {
  return { "site.content.data": br?.site?.content?.data ?? null, "user.data": br?.user?.data ?? null };
}
function strip(r: Json) {
  const { _reader, _dsp, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}
