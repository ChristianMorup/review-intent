import { describe, it, expect } from "vitest";
import { THEMES, TOKEN_KEYS, themeCss, makeTheme } from "../src/themes.js";

describe("themes", () => {
  it("every theme defines every token key", () => {
    for (const t of THEMES) {
      for (const k of TOKEN_KEYS) {
        expect(t.tokens[k], `${t.id} missing ${k}`).toBeTruthy();
      }
    }
  });

  it("theme ids are unique and DOM-safe", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("includes the named themes", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["dark", "hacker"]));
  });

  it("themeCss emits one selector per theme and no :root", () => {
    const css = themeCss();
    for (const t of THEMES) {
      expect(css).toContain(`[data-theme="${t.id}"]`);
    }
    expect(css).not.toContain(":root");
  });

  it("makeTheme expands core values into the full token set", () => {
    const t = makeTheme("x", "X", "Test", {
      paper: "#000", surface: "#111", surface2: "#222", ink: "#fff",
      inkSoft: "#ddd", muted: "#999", line: "#333", line2: "#444",
      accent: "#0af", accentSoft: "#013", add: "#0f0", addSoft: "#020",
      del: "#f00", delSoft: "#200", warn: "#fa0", warnSoft: "#210",
    });
    for (const k of TOKEN_KEYS) expect(t.tokens[k]).toBeTruthy();
    expect(t.tokens["--paper"]).toBe("#000");
    expect(t.tokens["--add-border"]).toBe("#0f0"); // derived aliases core
  });
});
