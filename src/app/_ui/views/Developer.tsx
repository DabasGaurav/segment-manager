"use client";
import { PageHeader, Tag, useApp } from "../App";
import { TaxonomyLookup } from "../../_components/TaxonomyLookup";
import { DetectionLab } from "../../_components/DetectionLab";

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/v1/resolve", "Bidder service key. Validates, translates and policy-checks one bid request's segments."],
  ["POST", "/v1/publishers/{pid}/imports", "Publisher ops. Imports a signal dictionary (Idempotency-Key header)."],
  ["GET", "/v1/publishers/{pid}/proposals?status=", "Ops, reviewer, admin. Suggested mappings and their status."],
  ["POST", "/v1/publishers/{pid}/proposals/{id}/decision", "Reviewer. approve · choose_other · abstain · revoke (with row_version)."],
  ["GET · PUT", "/v1/publishers/{pid}/grant", "Read: ops, reviewer. Write: publisher ops. Buyer list and unmapped handling."],
  ["GET · POST", "/v1/publishers/{pid}/mapping-versions", "Read: ops, reviewer. Publish: reviewer. Frozen, hashed versions."],
  ["PUT", "/v1/publishers/{pid}/active-version", "Reviewer. Makes a version live; an older one is a rollback."],
  ["GET", "/v1/publishers/{pid}/audit", "Ops, reviewer, admin. Append-only activity log."],
  ["GET", "/v1/taxonomies/{taxonomy}/{version}/nodes/{id}", "Any signed-in persona or bidder key. Official IAB node lookup."],
  ["GET", "/health", "Public. Database and taxonomy-file status."],
  ["POST · DELETE", "/v1/demo/sessions", "Demo only. Sign in as a synthetic persona (signed, httpOnly cookie)."],
  ["POST", "/v1/demo/reset", "Demo only. Restores the synthetic sample data."],
];

export function DeveloperView() {
  const { persona, lastResolve } = useApp();
  return (
    <div className="stack">
      <PageHeader
        title="API & technical details"
        lead="Everything the screens do goes through these endpoints. Errors use application/problem+json with a stable code and a request ID."
      />
      <section className="card">
        <h2>Try the API</h2>
        <p className="muted">
          Public demo key: read-only, can call <code>/v1/resolve</code> only, 60 calls a minute, synthetic data only. <Tag tone="synthetic">Synthetic</Tag>
        </p>
        <pre>{`curl -X POST https://segment-manager.vercel.app/v1/resolve \\
  -H "Authorization: Bearer sm_demo_221a2fb7b219328915e3e40c" \\
  -H "Content-Type: application/json" \\
  -d '{"publisher_id":"pub_metrodaily","dsp":"ttd","bid_request":{"id":"r1","imp":[{"id":"1"}],
       "user":{"data":[{"name":"metrodaily.example","ext":{"segtax":4},"segment":[{"id":"253"},{"id":"99999"}]}]},
       "device":{"geo":{"country":"IND"}},"regs":{"gdpr":0}}}'`}</pre>
      </section>
      <section className="card">
        <h2>Endpoints</h2>
        <table className="table">
          <thead><tr><th>Method</th><th>Path</th><th>Who and what</th></tr></thead>
          <tbody>
            {ENDPOINTS.map(([m, p, w]) => (
              <tr key={p}><td><code>{m}</code></td><td><code>{p}</code></td><td>{w}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Security: service keys are stored only as SHA-256 hashes; another publisher&apos;s data returns 404; ops and reviewers are separate roles;
          concurrent edits get 409; bodies over 64 KB get 413; any internal error strips all segments (fail closed). Content output uses IAB Content 3.0 (segtax 7);
          Content 3.1 is segtax 9.
        </p>
      </section>
      <TaxonomyLookup signedIn={!!persona} />
      <DetectionLab signedIn={!!persona} />
      {lastResolve && (
        <section className="card">
          <h2>Last verification response</h2>
          <pre className="tall">{JSON.stringify(lastResolve, (k, v) => (k.startsWith("_") ? undefined : v), 2)}</pre>
        </section>
      )}
    </div>
  );
}
