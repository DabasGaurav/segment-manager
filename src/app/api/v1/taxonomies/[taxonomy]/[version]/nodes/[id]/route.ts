import { requirePrincipal } from "@/lib/auth/principal";
import { ApiError, handler, json } from "@/lib/http/problem";
import { getRegistry, lookupNode } from "@/lib/taxonomy/registry";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ taxonomy: string; version: string; id: string }> };

/**
 * GET /v1/taxonomies/{taxonomy}/{version}/nodes/{id}
 * Validates and describes one official IAB node. Any authenticated caller. Carries no tenant data.
 */
export const GET = handler<Ctx>(async (req, ctx, requestId) => {
  await requirePrincipal(req);
  const { taxonomy, version, id } = await ctx.params;
  let reg;
  try {
    reg = getRegistry();
  } catch {
    throw new ApiError(503, "TAXONOMY_UNAVAILABLE", "Official taxonomy files failed verification; lookups are disabled.", undefined, { "retry-after": "60" });
  }
  const { taxonomy: tax, node } = lookupNode(reg, taxonomy, version, id);
  if (!tax) {
    const known = [...reg.byKey.keys()].join(", ");
    throw new ApiError(404, "TAXONOMY_NOT_FOUND", `Unknown taxonomy "${taxonomy}/${version}". Known: ${known}.`);
  }
  if (!node) throw new ApiError(404, "NODE_NOT_FOUND", `ID "${id}" does not exist in ${tax.label}.`);
  const parent = node.parentId ? tax.nodes.get(node.parentId) ?? null : null;
  return json(requestId, {
    taxonomy: tax.kind,
    version: tax.version,
    segtax: tax.segtax,
    node: {
      id: node.id,
      name: node.name,
      parent: parent ? { id: parent.id, name: parent.name } : null,
      path: node.path,
      tier1: node.tier1,
      children: tax.childCount.get(node.id) ?? 0,
      extension_note: node.extensionNote,
    },
    source: { file: tax.file, sha256: tax.sha256, publisher: "IAB Tech Lab (official TSV)" },
  });
});
