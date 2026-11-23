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
  // People and the bidder may look up nodes. The evaluator read-only key is resolve-only (A3.3).
  await requirePrincipal(req, ["publisher_ops", "reviewer", "curator", "admin", "bidder_service"]);
  const { taxonomy, version, id } = await ctx.params;
  if (!/^(content|audience)$/.test(taxonomy) || !/^\d\.\d$/.test(version)) {
    throw new ApiError(404, "TAXONOMY_NOT_FOUND", "Unknown taxonomy. Use content/2.2, content/3.0, content/3.1 or audience/1.1.");
  }
  if (!/^[A-Za-z0-9]{1,16}$/.test(id)) throw new ApiError(404, "NODE_NOT_FOUND", "Node not found.");
  let reg;
  try {
    reg = getRegistry();
  } catch {
    throw new ApiError(503, "TAXONOMY_UNAVAILABLE", "Official taxonomy files failed verification; lookups are disabled.", undefined, { "retry-after": "60" });
  }
  const { taxonomy: tax, node } = lookupNode(reg, taxonomy, version, id);
  if (!tax) {
    throw new ApiError(404, "TAXONOMY_NOT_FOUND", "Unknown taxonomy. Use content/2.2, content/3.0, content/3.1 or audience/1.1.");
  }
  if (!node) throw new ApiError(404, "NODE_NOT_FOUND", `This ID does not exist in ${tax.label}.`);
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
