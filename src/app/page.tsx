import { prisma } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { demoModeEnabled } from "@/lib/auth/session";
import { getRegistry } from "@/lib/taxonomy/registry";
import { PersonaSwitcher } from "./_components/PersonaSwitcher";
import { DetectionLab } from "./_components/DetectionLab";
import { TaxonomyLookup } from "./_components/TaxonomyLookup";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  const personas = demoModeEnabled()
    ? (await prisma.user.findMany({ where: { isDemo: true }, include: { publishers: true }, orderBy: { id: "asc" } })).map((u) => ({
        persona: u.persona,
        displayName: u.displayName,
        role: u.role,
        publishers: u.publishers.map((p) => p.publisherId),
      }))
    : [];
  let taxonomies: { key: string; label: string; segtax: number; nodes: number; sha256: string }[] = [];
  let taxonomyError: string | null = null;
  try {
    taxonomies = [...getRegistry().byKey.values()].map((t) => ({ key: t.key, label: t.label, segtax: t.segtax, nodes: t.nodes.size, sha256: t.sha256 }));
  } catch (e) {
    taxonomyError = e instanceof Error ? e.message : "failed";
  }

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="row">
            <h1>Segment Manager</h1>
            <span className="chip synthetic">Prototype · synthetic publishers</span>
          </div>
          {demoModeEnabled() && <PersonaSwitcher personas={personas} current={user?.persona ?? null} />}
        </div>
      </header>
      <main className="wrap">
        <section className="card">
          <h2>What this is</h2>
          <p>
            An internal API that checks the targeting segments publishers send in bid requests. Segments already in a standard IAB
            format are passed through. Publisher-specific IDs are translated to IAB IDs only through human-approved mappings, and
            only where consent and the publisher&apos;s permission allow it. Every decision comes with a reason code.
          </p>
          <p className="muted">
            Checkpoint 1 build: official taxonomy loading, node lookup and signal detection are live. Mapping, review, permissions,
            consent checks and the resolve API come next.
          </p>
        </section>

        <section className="card">
          <h2>Official taxonomy files <span className="chip real">Verified at load</span></h2>
          {taxonomyError ? (
            <p className="bad">Taxonomy files failed verification: {taxonomyError}. All lookups are disabled.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Taxonomy</th><th>segtax</th><th>Nodes</th><th>SHA-256 (matches SHA256SUMS.txt)</th></tr></thead>
                <tbody>
                  {taxonomies.map((t) => (
                    <tr key={t.key}><td>{t.label}</td><td>{t.segtax}</td><td>{t.nodes}</td><td><code>{t.sha256.slice(0, 16)}…</code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted">Source: IAB Tech Lab Taxonomies repository on GitHub, downloaded 23 Nov 2026. segtax values from AdCOM 1.0.</p>
        </section>

        <TaxonomyLookup signedIn={!!user} />
        <DetectionLab signedIn={!!user} />
      </main>
    </>
  );
}
