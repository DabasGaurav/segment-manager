"use client";
import { useState } from "react";
import { AccessState, PageHeader, useApp } from "../App";
import type { Json } from "../client";

function describe(e: Json, labels: Map<string, string>): string {
  const ent = String(e.entity ?? "");
  const pid = ent.startsWith("proposal:") ? ent.slice(9) : "";
  const what = labels.get(pid) ?? "a signal";
  const a = e.after ?? {};
  switch (e.action) {
    case "import.created": return `imported the dictionary (${a.entries ?? "?"} entries, ${a.proposals_created ?? 0} new suggestions, ${a.auto_approved ?? 0} auto-approved)`;
    case "proposal.approve": return `approved ${what}${a.target ? ` → IAB ${a.target}` : ""}`;
    case "proposal.choose_other": return `mapped ${what} → IAB ${a.target ?? "?"}${a.class === "AUDIENCE_INTEREST" ? " as reader interest" : ""}`;
    case "proposal.abstain": return `left ${what} unmapped`;
    case "proposal.revoke": return `revoked ${what}`;
    case "grant.updated": return `set buyer permissions: translate for ${(a.dsp_allowlist ?? []).join(", ") || "no buyers"}; unmapped IDs ${a.unmapped_handling === "drop" ? "removed" : "passed on"}`;
    case "version.published": return `published version ${e.mapping_version} (${a.entries ?? "?"} mappings)`;
    case "version.activated": return `made version ${e.mapping_version} live`;
    case "version.rolled_back": return `rolled back to version ${e.mapping_version}`;
    case "resolve.executed": return `ran a bid request through the resolver${e.mapping_version ? ` (version ${e.mapping_version})` : ""}`;
    default: return e.action;
  }
}

export function ActivityView() {
  const { data, loaded } = useApp();
  const [showChecks, setShowChecks] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const labels = new Map<string, string>(data.proposals.map((p) => [p.id, p.label ?? p.raw_id]));
  const events = data.audit.filter((e) => showChecks || e.action !== "resolve.executed");
  return (
    <div className="stack">
      <PageHeader title="Activity log" lead="Every change to DriveDesk's setup, with who did it and when. The log is append-only: the database refuses edits and deletes. It never stores reader IDs, consent strings or IP addresses." />
      {data.denied ? (
        <AccessState />
      ) : !loaded ? (
        <div className="skeleton">Loading…</div>
      ) : (
        <section className="card">
          <label className="check small"><input type="checkbox" checked={showChecks} onChange={(e) => setShowChecks(e.target.checked)} /> Include verification runs</label>
          {events.length === 0 ? (
            <div className="empty small">No activity yet. Import DriveDesk&apos;s dictionary to begin.</div>
          ) : (
            <ol className="timeline">
              {events.map((e, i) => (
                <li key={i}>
                  <span className="t-time">{new Date(e.at).toLocaleTimeString()}</span>
                  <span className="t-text"><strong>{String(e.actor).replace(/\s*\(.*\)$/, "")}</strong> {describe(e, labels)}</span>
                  <button className="link-btn small" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Hide" : "Details"}</button>
                  {open === i && <pre className="small">{JSON.stringify({ action: e.action, actor: e.actor, entity: e.entity, before: e.before, after: e.after, request_id_hash: e.request_id_hash }, null, 2)}</pre>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
