import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError, DEFAULT_CONFIG } from "../src/config.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ri-config-"));
}

function writeConfig(dir: string, contents: string): void {
  mkdirSync(join(dir, ".review"), { recursive: true });
  writeFileSync(join(dir, ".review", "config.json"), contents, "utf8");
}

describe("loadConfig", () => {
  it("returns built-in defaults when no config file exists", () => {
    expect(loadConfig(scratch())).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial overrides over the defaults", () => {
    const dir = scratch();
    writeConfig(dir, JSON.stringify({ churnFiles: 5 }));
    const cfg = loadConfig(dir);
    expect(cfg.churnFiles).toBe(5);
    expect(cfg.churnLines).toBe(DEFAULT_CONFIG.churnLines);
    expect(cfg.sensitivePaths).toEqual(DEFAULT_CONFIG.sensitivePaths);
  });

  it("replaces sensitivePaths entirely when provided", () => {
    const dir = scratch();
    writeConfig(dir, JSON.stringify({ sensitivePaths: [{ label: "pii", pattern: "pii" }] }));
    expect(loadConfig(dir).sensitivePaths).toEqual([{ label: "pii", pattern: "pii" }]);
  });

  it("throws ConfigError on invalid JSON", () => {
    const dir = scratch();
    writeConfig(dir, "{ nope");
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it("throws ConfigError on schema violations", () => {
    const dir = scratch();
    writeConfig(dir, JSON.stringify({ churnFiles: -3 }));
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });
});
