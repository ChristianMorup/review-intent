import * as fs from "node:fs/promises";
import * as path from "node:path";

/** The MCP server key written into `.mcp.json`. */
export const MCP_SERVER_NAME = "review-intent";

/**
 * The server entry we register: bare `review-intent mcp`, so it works with a
 * global or `npx` install. Matches the snippet in the README.
 */
export const MCP_SERVER_ENTRY: { command: string; args: string[] } = {
  command: "review-intent",
  args: ["mcp"],
};

/** Thrown when an existing `.mcp.json` can't be safely merged (it isn't valid
 *  JSON, or isn't a JSON object). We refuse to clobber it rather than guess. */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

export interface McpConfigOptions {
  /** Directory holding `.mcp.json` (defaults to process.cwd()). */
  cwd?: string;
}

export function mcpConfigPath(opts: McpConfigOptions = {}): string {
  return path.join(opts.cwd ?? process.cwd(), ".mcp.json");
}

type Json = Record<string, unknown>;

export type McpInstallResult = "installed" | "updated" | "already" | "conflict";
export type McpUninstallResult = "removed" | "not-installed" | "modified";

/**
 * Pure: merge our server entry into a parsed `.mcp.json` object, preserving
 * every other key and every other server. Returns the new config and what
 * happened. `config` is only meant to be written when the result is
 * installed/updated.
 */
export function planInstall(
  existing: Json | null,
  force: boolean,
): { config: Json; result: McpInstallResult } {
  const config: Json = { ...(existing ?? {}) };
  const servers: Json = { ...((config.mcpServers as Json | undefined) ?? {}) };
  const current = servers[MCP_SERVER_NAME];

  if (current !== undefined && jsonEqual(current, MCP_SERVER_ENTRY)) {
    return { config, result: "already" };
  }
  if (current !== undefined && !force) {
    return { config, result: "conflict" };
  }

  const result: McpInstallResult = current !== undefined ? "updated" : "installed";
  servers[MCP_SERVER_NAME] = { ...MCP_SERVER_ENTRY };
  config.mcpServers = servers;
  return { config, result };
}

/**
 * Pure: remove our server entry, preserving every other key and server. If
 * `mcpServers` ends up empty the key is dropped; the caller decides whether an
 * otherwise-empty file should be deleted.
 */
export function planUninstall(
  existing: Json | null,
  force: boolean,
): { config: Json | null; result: McpUninstallResult } {
  const servers = existing?.mcpServers as Json | undefined;
  if (!servers || !(MCP_SERVER_NAME in servers)) {
    return { config: existing, result: "not-installed" };
  }
  if (!jsonEqual(servers[MCP_SERVER_NAME], MCP_SERVER_ENTRY) && !force) {
    return { config: existing, result: "modified" };
  }

  const newServers: Json = { ...servers };
  delete newServers[MCP_SERVER_NAME];
  const config: Json = { ...(existing as Json) };
  if (Object.keys(newServers).length === 0) delete config.mcpServers;
  else config.mcpServers = newServers;
  return { config, result: "removed" };
}

export async function installMcp(
  opts: { force?: boolean } & McpConfigOptions = {},
): Promise<McpInstallResult> {
  const file = mcpConfigPath(opts);
  const existing = await readConfig(file);
  const { config, result } = planInstall(existing, opts.force ?? false);
  if (result === "installed" || result === "updated") {
    await writeConfig(file, config);
  }
  return result;
}

export async function uninstallMcp(
  opts: { force?: boolean } & McpConfigOptions = {},
): Promise<McpUninstallResult> {
  const file = mcpConfigPath(opts);
  const existing = await readConfig(file);
  const { config, result } = planUninstall(existing, opts.force ?? false);
  if (result === "removed" && config) {
    // A file we've emptied entirely is removed; otherwise write the merge back.
    if (Object.keys(config).length === 0) await fs.rm(file);
    else await writeConfig(file, config);
  }
  return result;
}

async function readConfig(file: string): Promise<Json | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new McpConfigError(
      `${file} is not valid JSON — leaving it untouched. Fix or remove it, then re-run.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new McpConfigError(`${file} is not a JSON object — leaving it untouched.`);
  }
  return parsed as Json;
}

async function writeConfig(file: string, config: Json): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/** Structural equality for JSON values — so a hand-written entry with a
 *  different key order still compares equal to our default. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ak = Object.keys(a as Json);
    const bk = Object.keys(b as Json);
    if (ak.length !== bk.length) return false;
    return ak.every(
      (k) => k in (b as Json) && jsonEqual((a as Json)[k], (b as Json)[k]),
    );
  }
  return false;
}
