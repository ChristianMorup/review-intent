import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ArtifactSchema, type Artifact } from "./types.js";

export const DEFAULT_ARTIFACT_PATH = ".review/intent.json";

export class ArtifactError extends Error {}

/**
 * Locate, parse, and validate the agent-authored intent artifact.
 * Throws ArtifactError with a friendly, actionable message on any problem.
 */
export function loadArtifact(
  cwd: string,
  artifactPath: string = DEFAULT_ARTIFACT_PATH,
): Artifact {
  const full = resolve(cwd, artifactPath);

  if (!existsSync(full)) {
    throw new ArtifactError(
      `No intent artifact found at ${full}\n\n` +
        `The agent that made the changes must write one. Minimal example:\n\n` +
        `  {\n` +
        `    "title": "Short change-set title",\n` +
        `    "overall": "Why this change set exists, what was rejected.",\n` +
        `    "diagrams": { "class": "classDiagram\\n  ...", "sequence": "sequenceDiagram\\n  ..." },\n` +
        `    "files": [\n` +
        `      { "path": "src/foo.ts", "intent": "Why this file changed",\n` +
        `        "hunks": [ { "anchor": 42, "intent": "Why this change" } ] }\n` +
        `    ]\n` +
        `  }\n\n` +
        `Pass --artifact <path> to point at a different location.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (err) {
    throw new ArtifactError(`Could not read ${full}: ${(err as Error).message}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ArtifactError(
      `${full} is not valid JSON: ${(err as Error).message}`,
    );
  }

  const result = ArtifactSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ArtifactError(
      `${full} does not match the expected schema:\n${issues}`,
    );
  }

  return result.data;
}
