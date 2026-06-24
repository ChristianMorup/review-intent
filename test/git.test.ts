import { describe, it, expect } from "vitest";
import { parseGitStatus } from "../src/git.js";

describe("parseGitStatus", () => {
  it("classifies staged, unstaged, and both-column changes as uncommitted (by path)", () => {
    const out = " M src/a.ts\nM  src/b.ts\nMM src/c.ts\nA  src/d.ts\nD  src/e.ts\n";
    const { uncommittedFiles, untrackedFiles } = parseGitStatus(out);
    expect(uncommittedFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"]);
    expect(untrackedFiles).toEqual([]);
  });

  it("classifies ?? entries as untracked", () => {
    const { uncommittedFiles, untrackedFiles } = parseGitStatus("?? src/new.ts\n?? docs/x.md\n");
    expect(untrackedFiles).toEqual(["src/new.ts", "docs/x.md"]);
    expect(uncommittedFiles).toEqual([]);
  });

  it("takes the new path for a rename", () => {
    const { uncommittedFiles } = parseGitStatus("R  src/old.ts -> src/new.ts\n");
    expect(uncommittedFiles).toEqual(["src/new.ts"]);
  });

  it("dequotes paths that git wrapped in double quotes", () => {
    const { untrackedFiles } = parseGitStatus('?? "src/with space.ts"\n');
    expect(untrackedFiles).toEqual(["src/with space.ts"]);
  });

  it("ignores blank lines and an empty status", () => {
    expect(parseGitStatus("")).toEqual({ uncommittedFiles: [], untrackedFiles: [] });
    expect(parseGitStatus("\n\n")).toEqual({ uncommittedFiles: [], untrackedFiles: [] });
  });
});
