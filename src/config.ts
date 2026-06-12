import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { RepoConfig } from "./types.js";

export const DEFAULT_CONFIG_PATH = ".review/config.json";

/** Built-in sensitive-path policy, tuned to the Immeo stack. Each pattern is a
 *  regex tested against the posix-style changed path (case-insensitive). */
export const DEFAULT_SENSITIVE_PATHS: RepoConfig["sensitivePaths"] = [
  { label: "auth", pattern: "(^|/)auth" },
  { label: "bicep / infra", pattern: "\\.bicep$|(^|/)bicep/" },
  { label: "ADO pipeline", pattern: "azure-pipelines|(^|/)\\.azure" },
  { label: "app config", pattern: "appsettings.*\\.json$|\\.config$" },
  { label: "secrets / key vault", pattern: "(secret|keyvault|key-vault)" },
  { label: "container", pattern: "(^|/)dockerfile" },
  { label: "dependencies", pattern: "\\.csproj$|directory\\.packages\\.props$|package-lock\\.json$|packages\\.lock\\.json$" },
];

export const DEFAULT_CONFIG: RepoConfig = {
  sensitivePaths: DEFAULT_SENSITIVE_PATHS,
  churnFiles: 20,
  churnLines: 600,
  complexityThreshold: 15,
};

const ConfigFileSchema = z.object({
  sensitivePaths: z
    .array(z.object({ label: z.string().min(1), pattern: z.string().min(1) }))
    .optional(),
  churnFiles: z.number().int().positive().optional(),
  churnLines: z.number().int().positive().optional(),
  complexityThreshold: z.number().int().positive().optional(),
});

export class ConfigError extends Error {}

/** Load the optional repo config, falling back to built-in defaults. Validation
 *  failures throw ConfigError (a malformed policy file should be loud). */
export function loadConfig(
  cwd: string,
  configPath: string = DEFAULT_CONFIG_PATH,
): RepoConfig {
  const full = resolve(cwd, configPath);
  if (!existsSync(full)) return DEFAULT_CONFIG;

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(full, "utf8"));
  } catch (err) {
    throw new ConfigError(`${full} is not valid JSON: ${(err as Error).message}`);
  }

  const parsed = ConfigFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`${full} is not a valid config:\n${issues}`);
  }

  return {
    sensitivePaths: parsed.data.sensitivePaths ?? DEFAULT_SENSITIVE_PATHS,
    churnFiles: parsed.data.churnFiles ?? DEFAULT_CONFIG.churnFiles,
    churnLines: parsed.data.churnLines ?? DEFAULT_CONFIG.churnLines,
    complexityThreshold: parsed.data.complexityThreshold ?? DEFAULT_CONFIG.complexityThreshold,
  };
}
