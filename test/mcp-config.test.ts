import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  planInstall,
  planUninstall,
  installMcp,
  uninstallMcp,
  mcpConfigPath,
  MCP_SERVER_NAME,
  MCP_SERVER_ENTRY,
  McpConfigError,
} from "../src/mcp-config.js";

// The merge logic is pure (planInstall/planUninstall) and gets the bulk of the
// coverage; a few fs round-trips confirm the install/uninstall wiring against a
// real temp .mcp.json (mirrors skill.test.ts).

describe("planInstall", () => {
  it("adds our entry to a missing config", () => {
    const { config, result } = planInstall(null, false);
    expect(result).toBe("installed");
    expect(config).toEqual({ mcpServers: { [MCP_SERVER_NAME]: MCP_SERVER_ENTRY } });
  });

  it("preserves other servers and other top-level keys", () => {
    const existing = {
      $schema: "x",
      mcpServers: { other: { command: "other", args: [] } },
    };
    const { config, result } = planInstall(existing, false);
    expect(result).toBe("installed");
    expect(config).toEqual({
      $schema: "x",
      mcpServers: {
        other: { command: "other", args: [] },
        [MCP_SERVER_NAME]: MCP_SERVER_ENTRY,
      },
    });
    // input not mutated
    expect(existing.mcpServers).toEqual({ other: { command: "other", args: [] } });
  });

  it("is a no-op when our exact entry is already present", () => {
    const existing = { mcpServers: { [MCP_SERVER_NAME]: { ...MCP_SERVER_ENTRY } } };
    expect(planInstall(existing, false).result).toBe("already");
  });

  it("treats a key-reordered entry as already present (structural equality)", () => {
    const existing = { mcpServers: { [MCP_SERVER_NAME]: { args: ["mcp"], command: "review-intent" } } };
    expect(planInstall(existing, false).result).toBe("already");
  });

  it("conflicts on a differing entry without force, and updates with force", () => {
    const existing = {
      mcpServers: { [MCP_SERVER_NAME]: { command: "node", args: ["server.js"] } },
    };
    expect(planInstall(existing, false).result).toBe("conflict");
    const forced = planInstall(existing, true);
    expect(forced.result).toBe("updated");
    expect(forced.config.mcpServers).toEqual({ [MCP_SERVER_NAME]: MCP_SERVER_ENTRY });
  });
});

describe("planUninstall", () => {
  it("reports not-installed for a missing config or absent entry", () => {
    expect(planUninstall(null, false).result).toBe("not-installed");
    expect(planUninstall({ mcpServers: { other: {} } }, false).result).toBe("not-installed");
  });

  it("removes our entry and preserves the rest", () => {
    const existing = {
      $schema: "x",
      mcpServers: { other: { command: "other", args: [] }, [MCP_SERVER_NAME]: { ...MCP_SERVER_ENTRY } },
    };
    const { config, result } = planUninstall(existing, false);
    expect(result).toBe("removed");
    expect(config).toEqual({ $schema: "x", mcpServers: { other: { command: "other", args: [] } } });
  });

  it("drops the mcpServers key when our entry was the only one", () => {
    const existing = { mcpServers: { [MCP_SERVER_NAME]: { ...MCP_SERVER_ENTRY } } };
    const { config, result } = planUninstall(existing, false);
    expect(result).toBe("removed");
    expect(config).toEqual({});
  });

  it("refuses a modified entry without force, removes it with force", () => {
    const existing = { mcpServers: { [MCP_SERVER_NAME]: { command: "node", args: ["x"] } } };
    expect(planUninstall(existing, false).result).toBe("modified");
    expect(planUninstall(existing, true).result).toBe("removed");
  });
});

describe("installMcp / uninstallMcp (fs round-trip)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ri-mcp-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const read = async () => JSON.parse(await fs.readFile(mcpConfigPath({ cwd: dir }), "utf8"));

  it("creates .mcp.json on first install and is idempotent", async () => {
    expect(await installMcp({ cwd: dir })).toBe("installed");
    expect(await read()).toEqual({ mcpServers: { [MCP_SERVER_NAME]: MCP_SERVER_ENTRY } });
    expect(await installMcp({ cwd: dir })).toBe("already");
  });

  it("merges into an existing file without disturbing other servers", async () => {
    await fs.writeFile(
      mcpConfigPath({ cwd: dir }),
      JSON.stringify({ mcpServers: { other: { command: "x", args: [] } } }),
      "utf8",
    );
    expect(await installMcp({ cwd: dir })).toBe("installed");
    const cfg = await read();
    expect(cfg.mcpServers.other).toEqual({ command: "x", args: [] });
    expect(cfg.mcpServers[MCP_SERVER_NAME]).toEqual(MCP_SERVER_ENTRY);
  });

  it("uninstall removes our entry; deletes the file when it empties out", async () => {
    await installMcp({ cwd: dir });
    expect(await uninstallMcp({ cwd: dir })).toBe("removed");
    await expect(fs.access(mcpConfigPath({ cwd: dir }))).rejects.toThrow();
    expect(await uninstallMcp({ cwd: dir })).toBe("not-installed");
  });

  it("refuses to touch an invalid .mcp.json", async () => {
    await fs.writeFile(mcpConfigPath({ cwd: dir }), "{ not json", "utf8");
    await expect(installMcp({ cwd: dir })).rejects.toBeInstanceOf(McpConfigError);
    // the bad file is left exactly as-is
    expect(await fs.readFile(mcpConfigPath({ cwd: dir }), "utf8")).toBe("{ not json");
  });
});
