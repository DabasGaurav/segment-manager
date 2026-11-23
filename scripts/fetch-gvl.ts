/**
 * Build step: try to fetch the live IAB Global Vendor List and pin vendor 142's declaration.
 * On any failure the app uses the clearly labelled illustrative fixture instead, and every
 * /v1/resolve response says which source was used (gvl_source).
 */
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "gvl", "vendor-142.live.json");
const URL = "https://vendor-list.consensu.org/v3/vendor-list.json";

async function main() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gvl = (await res.json()) as { vendorListVersion: number; tcfPolicyVersion: number; lastUpdated: string; vendors: Record<string, Record<string, unknown>> };
    const v = gvl.vendors?.["142"];
    if (!v || !Array.isArray(v.purposes)) throw new Error("vendor 142 missing from GVL");
    const pick = (k: string) => (Array.isArray(v[k]) ? (v[k] as number[]) : []);
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          source: `gvl:v${gvl.vendorListVersion}`,
          note: `Pinned from ${URL} at build time.`,
          fetchedAt: new Date().toISOString(),
          vendorListVersion: gvl.vendorListVersion,
          tcfPolicyVersion: gvl.tcfPolicyVersion,
          lastUpdated: gvl.lastUpdated,
          vendor: {
            id: 142,
            name: String(v.name ?? "Media.net"),
            purposes: pick("purposes"),
            legIntPurposes: pick("legIntPurposes"),
            flexiblePurposes: pick("flexiblePurposes"),
            specialPurposes: pick("specialPurposes"),
            features: pick("features"),
            specialFeatures: pick("specialFeatures"),
            deletedDate: v.deletedDate ?? null,
          },
        },
        null,
        2,
      ),
    );
    console.log(`[fetch-gvl] pinned vendor 142 from GVL v${gvl.vendorListVersion}`);
  } catch (e) {
    rmSync(OUT, { force: true });
    console.warn(`[fetch-gvl] could not fetch the live GVL (${(e as Error).message}); the illustrative fixture will be used.`);
  }
}
main();
