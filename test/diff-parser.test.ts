import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDiffText } from "../src/diff-parser.js";

const raw = readFileSync(
  join(import.meta.dirname, "fixtures", "sample.diff"),
  "utf8",
);

describe("parseDiffText", () => {
  const files = parseDiffText(raw);

  it("parses each changed file with a path and status", () => {
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("src/greet.ts");
    expect(files[0].status).toBe("modified");
    expect(files[1].path).toBe("src/new.ts");
    expect(files[1].status).toBe("added");
  });

  it("splits a modified file into its hunks with new-line ranges", () => {
    const greet = files[0];
    expect(greet.hunks).toHaveLength(2);
    expect(greet.hunks[0].newStart).toBe(1);
    expect(greet.hunks[0].newEnd).toBe(4);
    expect(greet.hunks[1].newStart).toBe(11);
  });

  it("classifies added, deleted, and normal lines and strips the marker", () => {
    const firstHunk = files[0].hunks[0];
    const added = firstHunk.lines.filter((l) => l.type === "add");
    const deleted = firstHunk.lines.filter((l) => l.type === "del");
    expect(deleted[0].content).toBe('  return "Hi " + name;');
    expect(added.some((l) => l.content.includes("Hello, ${name.trim()}"))).toBe(
      true,
    );
    // marker characters must be stripped, not retained
    expect(firstHunk.lines.every((l) => !l.content.startsWith("+"))).toBe(true);
  });

  it("tracks new-file line numbers on added lines", () => {
    const newFile = files[1];
    const adds = newFile.hunks[0].lines.filter((l) => l.type === "add");
    expect(adds[0].newNumber).toBe(1);
    expect(adds[1].newNumber).toBe(2);
  });
});
