import { describe, it, expect } from "vitest";
import { buildReachGraph, type RepoFile } from "../src/reach.js";

const repo: RepoFile[] = [
  { path: "src/util.ts", content: "export const x = 1;" },
  { path: "src/a.ts", content: "import { x } from './util';\nimport foo from '../lib/foo';" },
  { path: "src/b.ts", content: "const u = require('./util');" },
  { path: "src/unrelated.ts", content: "import { y } from './other';" },
  { path: "lib/foo.ts", content: "export default 1;" },
];

describe("buildReachGraph", () => {
  it("links files that import a changed file (relative + require)", () => {
    const reach = buildReachGraph(repo, ["src/util.ts"]);
    const dependents = reach.edges.filter((e) => e.to === "src/util.ts").map((e) => e.from).sort();
    expect(dependents).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("matches a changed file referenced by a parent-relative path", () => {
    const reach = buildReachGraph(repo, ["lib/foo.ts"]);
    expect(reach.edges).toContainEqual({ from: "src/a.ts", to: "lib/foo.ts" });
  });

  it("does not link unrelated importers", () => {
    const reach = buildReachGraph(repo, ["src/util.ts"]);
    expect(reach.edges.some((e) => e.from === "src/unrelated.ts")).toBe(false);
  });

  it("never links a changed file to itself", () => {
    const reach = buildReachGraph(repo, ["src/a.ts"]);
    expect(reach.edges.some((e) => e.from === "src/a.ts" && e.to === "src/a.ts")).toBe(false);
  });

  it("lists changed files as nodes even with no dependents", () => {
    const reach = buildReachGraph(repo, ["src/orphan.ts"]);
    expect(reach.changed).toEqual(["src/orphan.ts"]);
    expect(reach.edges).toHaveLength(0);
  });

  it("caps edges per node and reports the overflow without dropping silently", () => {
    const importers: RepoFile[] = Array.from({ length: 12 }, (_, i) => ({
      path: `src/c${i}.ts`,
      content: "import './util';",
    }));
    const reach = buildReachGraph([...importers], ["src/util.ts"], { maxEdgesPerNode: 5 });
    expect(reach.edges).toHaveLength(5);
    expect(reach.truncatedNote).toMatch(/additional edge\(s\) hidden/);
  });

  it("surfaces a scan-truncation note when asked", () => {
    const reach = buildReachGraph(repo, ["src/util.ts"], { scanTruncated: true });
    expect(reach.truncatedNote).toMatch(/file cap/);
  });
});
