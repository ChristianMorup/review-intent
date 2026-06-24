import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installSkill,
  uninstallSkill,
  skillFile,
  SKILL_CONTENT,
} from "../src/skill.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ri-skill-"));
});

describe("skillFile", () => {
  it("resolves user scope under ~/.claude/skills", () => {
    const f = skillFile({ scope: "user", home });
    expect(f).toBe(join(home, ".claude", "skills", "review-intent-authoring", "SKILL.md"));
  });

  it("resolves local scope under ./.claude/skills", () => {
    const f = skillFile({ scope: "local", cwd: home });
    expect(f).toContain(join(".claude", "skills", "review-intent-authoring"));
  });
});

describe("installSkill", () => {
  it("installs into a fresh location and writes the embedded content", async () => {
    const result = await installSkill({ scope: "user", home });
    expect(result).toBe("installed");
    const written = readFileSync(skillFile({ scope: "user", home }), "utf8");
    expect(written).toBe(SKILL_CONTENT);
  });

  it("reports 'already' when content is identical", async () => {
    await installSkill({ scope: "user", home });
    expect(await installSkill({ scope: "user", home })).toBe("already");
  });

  it("treats CRLF-rewritten content as unchanged", async () => {
    const file = skillFile({ scope: "user", home });
    mkdirSync(join(home, ".claude", "skills", "review-intent-authoring"), { recursive: true });
    writeFileSync(file, SKILL_CONTENT.replace(/\n/g, "\r\n"), "utf8");
    expect(await installSkill({ scope: "user", home })).toBe("already");
  });

  it("refuses to overwrite a modified file without --force", async () => {
    const file = skillFile({ scope: "user", home });
    mkdirSync(join(home, ".claude", "skills", "review-intent-authoring"), { recursive: true });
    writeFileSync(file, "hand edited", "utf8");
    expect(await installSkill({ scope: "user", home })).toBe("conflict");
    expect(readFileSync(file, "utf8")).toBe("hand edited");
  });

  it("overwrites a modified file with --force and reports 'updated'", async () => {
    const file = skillFile({ scope: "user", home });
    mkdirSync(join(home, ".claude", "skills", "review-intent-authoring"), { recursive: true });
    writeFileSync(file, "hand edited", "utf8");
    expect(await installSkill({ scope: "user", home, force: true })).toBe("updated");
    expect(readFileSync(file, "utf8")).toBe(SKILL_CONTENT);
  });
});

describe("uninstallSkill", () => {
  it("removes a clean install", async () => {
    await installSkill({ scope: "user", home });
    expect(await uninstallSkill({ scope: "user", home })).toBe("removed");
    expect(existsSync(skillFile({ scope: "user", home }))).toBe(false);
  });

  it("reports not-installed when absent", async () => {
    expect(await uninstallSkill({ scope: "user", home })).toBe("not-installed");
  });

  it("refuses to remove a modified file without --force", async () => {
    const file = skillFile({ scope: "user", home });
    mkdirSync(join(home, ".claude", "skills", "review-intent-authoring"), { recursive: true });
    writeFileSync(file, "hand edited", "utf8");
    expect(await uninstallSkill({ scope: "user", home })).toBe("modified");
    expect(existsSync(file)).toBe(true);
  });
});

describe("SKILL_CONTENT worktree guidance", () => {
  it("explains reviewing from a worktree", () => {
    expect(SKILL_CONTENT).toContain("Reviewing from a worktree");
  });
  it("says uncommitted and untracked work is folded in automatically", () => {
    expect(SKILL_CONTENT.toLowerCase()).toContain("untracked");
    expect(SKILL_CONTENT).toMatch(/don't need to commit|no need to commit|folded in/i);
  });
});
