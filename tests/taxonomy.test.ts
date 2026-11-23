import { cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRegistry, lookupNode, TaxonomyIntegrityError } from "@/lib/taxonomy/registry";

const DATA = path.join(process.cwd(), "data", "iab");
const reg = loadRegistry(DATA);

describe("T01 official taxonomy files", () => {
  it("every vendored TSV matches SHA256SUMS.txt", () => {
    for (const t of reg.byKey.values()) expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect([...reg.byKey.keys()].sort()).toEqual(["audience/1.1", "content/2.2", "content/3.0", "content/3.1"]);
  });

  it("node counts match the official files (checked by hand on 23 Nov 2026)", () => {
    expect(reg.byKey.get("content/2.2")!.nodes.size).toBe(1196);
    expect(reg.byKey.get("content/3.0")!.nodes.size).toBe(703);
    expect(reg.byKey.get("content/3.1")!.nodes.size).toBe(704);
    const aud = reg.byKey.get("audience/1.1")!;
    expect(aud.nodes.size).toBe(1558);
    const tiers = new Map<string, number>();
    for (const n of aud.nodes.values()) tiers.set(n.tier1, (tiers.get(n.tier1) ?? 0) + 1);
    expect(Object.fromEntries(tiers)).toEqual({ Demographic: 197, Interest: 497, "Purchase Intent*": 864 });
  });

  it("segtax values follow AdCOM 1.0 (4 Audience 1.1, 6 Content 2.2, 7 Content 3.0, 9 Content 3.1)", () => {
    expect(reg.bySegtax.get(4)!.key).toBe("audience/1.1");
    expect(reg.bySegtax.get(6)!.key).toBe("content/2.2");
    expect(reg.bySegtax.get(7)!.key).toBe("content/3.0");
    expect(reg.bySegtax.get(9)!.key).toBe("content/3.1");
  });

  it("refuses to load a tampered file (fail closed)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iab-"));
    cpSync(DATA, dir, { recursive: true });
    const f = path.join(dir, "Content_Taxonomy_3.0.tsv");
    writeFileSync(f, readFileSync(f, "utf8").replace("Green Vehicles", "Electric Vehicles"));
    expect(() => loadRegistry(dir)).toThrow(TaxonomyIntegrityError);
  });

  it("refuses to load when a checksum entry is missing", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "iab-"));
    cpSync(DATA, dir, { recursive: true });
    writeFileSync(path.join(dir, "SHA256SUMS.txt"), "");
    expect(() => loadRegistry(dir)).toThrow(/no checksum/);
  });
});

describe("T02 node lookup", () => {
  it("content/3.0/22 is Green Vehicles under Auto Type (16), Automotive", () => {
    const { node } = lookupNode(reg, "content", "3.0", "22");
    expect(node).toMatchObject({ id: "22", name: "Green Vehicles", parentId: "16", path: ["Automotive", "Auto Type", "Green Vehicles"] });
  });

  it("ID 22 means the same node in Content 2.2, 3.0 and 3.1", () => {
    for (const v of ["2.2", "3.0", "3.1"]) expect(lookupNode(reg, "content", v, "22").node?.name).toBe("Green Vehicles");
  });

  it("there is no Electric Vehicle node in Content 3.x", () => {
    for (const v of ["3.0", "3.1"]) {
      const names = [...reg.byKey.get(`content/${v}`)!.nodes.values()].map((n) => n.name.toLowerCase());
      expect(names.some((n) => n.includes("electric vehicle"))).toBe(false);
    }
  });

  it("audience/1.1/253 is Interest > Automotive > Green Vehicles", () => {
    const { node } = lookupNode(reg, "audience", "1.1", "253");
    expect(node).toMatchObject({ name: "Green Vehicles", tier1: "Interest", parentId: "243" });
  });

  it("audience/1.1/824 is Purchase Intent* > Automotive Ownership > New Vehicles > Green Vehicles, with the extension note", () => {
    const { node } = lookupNode(reg, "audience", "1.1", "824");
    expect(node?.path).toEqual(["Purchase Intent*", "Automotive Ownership", "New Vehicles", "Green Vehicles"]);
    expect(node?.extensionNote).toMatch(/Purchase Intent Classification/);
  });

  it("Content 3.1 alphanumeric IDs load; unknown IDs and versions return null", () => {
    expect(lookupNode(reg, "content", "3.1", "80DV8O").node).not.toBeNull();
    expect(lookupNode(reg, "content", "3.0", "99999").node).toBeNull();
    expect(lookupNode(reg, "content", "4.0", "22").taxonomy).toBeNull();
    expect(lookupNode(reg, "content", "3.0", "__proto__").node).toBeNull();
    expect(lookupNode(reg, "content", "3.0", " 22").node).toBeNull();
  });
});
