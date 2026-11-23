/**
 * Official IAB Tech Lab taxonomy registry.
 *
 * Source files are vendored byte-for-byte in /data/iab (see SOURCE.txt) and verified against
 * SHA256SUMS.txt every time the registry loads. If any checksum fails, loading throws and every
 * caller fails closed: nothing is validated or translated against an unverified file.
 *
 * segtax values come from AdCOM 1.0 "List: Category Taxonomies":
 *   4 = Audience 1.1, 6 = Content 2.2, 7 = Content 3.0, 9 = Content 3.1.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export type TaxonomyKind = "content" | "audience";

export interface TaxonomyDef {
  key: string; // e.g. "content/3.0"
  kind: TaxonomyKind;
  version: string;
  segtax: number;
  file: string;
  label: string;
}

export const TAXONOMY_DEFS: readonly TaxonomyDef[] = [
  { key: "content/2.2", kind: "content", version: "2.2", segtax: 6, file: "Content_Taxonomy_2.2.tsv", label: "IAB Content Taxonomy 2.2" },
  { key: "content/3.0", kind: "content", version: "3.0", segtax: 7, file: "Content_Taxonomy_3.0.tsv", label: "IAB Content Taxonomy 3.0" },
  { key: "content/3.1", kind: "content", version: "3.1", segtax: 9, file: "Content_Taxonomy_3.1.tsv", label: "IAB Content Taxonomy 3.1" },
  { key: "audience/1.1", kind: "audience", version: "1.1", segtax: 4, file: "Audience_Taxonomy_1.1.tsv", label: "IAB Audience Taxonomy 1.1" },
] as const;

export interface TaxonomyNode {
  id: string;
  parentId: string | null;
  name: string;
  /** Tier names from Tier 1 down to this node. */
  path: string[];
  tier1: string;
  extensionNote: string | null;
}

export interface LoadedTaxonomy extends TaxonomyDef {
  sha256: string;
  nodes: ReadonlyMap<string, TaxonomyNode>;
  childCount: ReadonlyMap<string, number>;
}

export interface Registry {
  byKey: ReadonlyMap<string, LoadedTaxonomy>;
  bySegtax: ReadonlyMap<number, LoadedTaxonomy>;
}

export class TaxonomyIntegrityError extends Error {}

function dataDir(): string {
  // Traced explicitly via outputFileTracingIncludes in next.config.ts.
  return process.env.IAB_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data", "iab");
}

function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) out.set(m[2]!.trim(), m[1]!);
  }
  return out;
}

const cell = (cols: string[], i: number): string => (cols[i] ?? "").trim();

/**
 * Parse one official TSV.
 * Content files: two header rows, then  ID | Parent | Name | Tier1..Tier4 | Extension.
 * Audience 1.1:  one header row, a leading empty column, then
 *                ID | Parent | Condensed Name | Tier1..Tier6 | *Extension Notes.
 */
export function parseTaxonomyTsv(def: TaxonomyDef, text: string): Map<string, TaxonomyNode> {
  const nodes = new Map<string, TaxonomyNode>();
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const cols = raw.split("\t");
    let id: string, parent: string, tiers: string[], name: string, ext: string;
    if (def.kind === "content") {
      id = cell(cols, 0);
      parent = cell(cols, 1);
      name = cell(cols, 2);
      tiers = [3, 4, 5, 6].map((i) => cell(cols, i)).filter(Boolean);
      ext = cell(cols, 7);
    } else {
      id = cell(cols, 1);
      parent = cell(cols, 2);
      tiers = [4, 5, 6, 7, 8, 9].map((i) => cell(cols, i)).filter(Boolean);
      name = tiers[tiers.length - 1] ?? "";
      ext = cell(cols, 10);
    }
    // Skip header rows and blank separator rows.
    if (!id || id === "Unique ID" || id === "Relational ID System") continue;
    if (!/^[A-Za-z0-9]+$/.test(id)) {
      throw new TaxonomyIntegrityError(`${def.file}: unexpected ID format "${id}"`);
    }
    if (nodes.has(id)) throw new TaxonomyIntegrityError(`${def.file}: duplicate ID ${id}`);
    if (!name) throw new TaxonomyIntegrityError(`${def.file}: row ${id} has no name`);
    nodes.set(id, {
      id,
      parentId: parent || null,
      name,
      path: tiers, // replaced below for content files
      tier1: tiers[0] ?? name,
      extensionNote: ext || null,
    });
  }
  for (const n of nodes.values()) {
    if (n.parentId && !nodes.has(n.parentId)) {
      throw new TaxonomyIntegrityError(`${def.file}: node ${n.id} references missing parent ${n.parentId}`);
    }
  }
  if (def.kind === "content") {
    // Content files leave some tier columns blank (e.g. the 2.2 "Sensitive Topics" rows), so the
    // path is rebuilt from the parent chain, which is complete in every file.
    const resolve = (n: TaxonomyNode, depth = 0): string[] => {
      if (depth > 10) throw new TaxonomyIntegrityError(`${def.file}: parent cycle at ${n.id}`);
      const parent = n.parentId ? nodes.get(n.parentId)! : null;
      return parent ? [...resolve(parent, depth + 1), n.name] : [n.name];
    };
    const paths = new Map<string, string[]>();
    for (const n of nodes.values()) paths.set(n.id, resolve(n));
    for (const n of nodes.values()) {
      n.path = paths.get(n.id)!;
      n.tier1 = n.path[0]!;
    }
  } else {
    for (const n of nodes.values()) {
      if (n.path.length === 0) throw new TaxonomyIntegrityError(`${def.file}: row ${n.id} has no tiers`);
    }
  }
  return nodes;
}

export function loadRegistry(dir: string = dataDir()): Registry {
  const sums = parseChecksums(readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, "SHA256SUMS.txt"), "utf8"));
  const byKey = new Map<string, LoadedTaxonomy>();
  const bySegtax = new Map<number, LoadedTaxonomy>();
  for (const def of TAXONOMY_DEFS) {
    const buf = readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, def.file));
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const expected = sums.get(def.file);
    if (!expected) throw new TaxonomyIntegrityError(`${def.file}: no checksum listed in SHA256SUMS.txt`);
    if (expected !== sha256) {
      throw new TaxonomyIntegrityError(`${def.file}: checksum mismatch (expected ${expected}, got ${sha256})`);
    }
    const nodes = parseTaxonomyTsv(def, buf.toString("utf8"));
    const childCount = new Map<string, number>();
    for (const n of nodes.values()) {
      if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
    }
    const loaded: LoadedTaxonomy = { ...def, sha256, nodes, childCount };
    byKey.set(def.key, loaded);
    bySegtax.set(def.segtax, loaded);
  }
  return { byKey, bySegtax };
}

let cached: Registry | null = null;
let cachedError: Error | null = null;

/** Process-wide registry. Throws (every time) if the files failed verification. */
export function getRegistry(): Registry {
  if (cached) return cached;
  if (cachedError) throw cachedError;
  try {
    cached = loadRegistry();
    return cached;
  } catch (e) {
    cachedError = e instanceof Error ? e : new Error(String(e));
    throw cachedError;
  }
}

/** For tests only. */
export function __resetRegistryForTests(): void {
  cached = null;
  cachedError = null;
}

export function lookupNode(reg: Registry, kind: string, version: string, id: string) {
  const tax = reg.byKey.get(`${kind}/${version}`);
  if (!tax) return { taxonomy: null, node: null } as const;
  return { taxonomy: tax, node: tax.nodes.get(id) ?? null } as const;
}
