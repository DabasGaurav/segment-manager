/** Mapping benchmark gates (SYNTHETIC hand-labelled set, data/benchmark/mapping-benchmark.json). */
import { describe, expect, it } from "vitest";
import { getRegistry } from "@/lib/taxonomy/registry";
import { mapEntry, type DictionaryEntryInput } from "@/lib/mapping/mapper";
import bench from "../data/benchmark/mapping-benchmark.json";

type Item = DictionaryEntryInput & { expect: string; expect_target: string | null };
const reg = getRegistry();
const items = (bench as { items: Item[] }).items;
const results = items.map((it) => {
  const d = mapEntry(reg, it);
  const name = d.target ? reg.bySegtax.get(d.target.segtax)?.nodes.get(d.target.id)?.name ?? null : null;
  return { it, d, name };
});

describe("mapping benchmark", () => {
  it("has a meaningful number of labelled items", () => expect(items.length).toBeGreaterThanOrEqual(60));
  it("auto-approved precision is 100%", () => {
    const auto = results.filter((r) => r.d.auto_approved);
    expect(auto.length).toBeGreaterThan(20);
    expect(auto.filter((r) => r.name !== r.it.expect_target).map((r) => r.it.raw_id)).toEqual([]);
  });
  it("purchase intent is never auto-approved (promotion false positives = 0)", () => {
    expect(results.filter((r) => r.it.declared_class === "PURCHASE_INTENT" && r.d.status === "APPROVED")).toEqual([]);
  });
  it("sensitive items are always blocked (leaks = 0)", () => {
    expect(results.filter((r) => r.it.expect === "blocked" && r.d.status !== "BLOCKED").map((r) => r.it.raw_id)).toEqual([]);
  });
  it("lexical items are never auto-approved, and the right node is in the top 3 for most", () => {
    const lex = results.filter((r) => r.it.expect === "review");
    expect(lex.some((r) => r.d.auto_approved)).toBe(false);
    const hit = lex.filter((r) => r.d.candidates.some((c) => c.name === r.it.expect_target)).length;
    expect(hit / lex.length).toBeGreaterThanOrEqual(0.75);
  });
});
