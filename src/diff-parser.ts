import parseDiff from "parse-diff";
import type { DiffFile, DiffHunk, DiffLine } from "./types.js";

/** Parse raw unified diff text into a structured, render-friendly model. */
export function parseDiffText(raw: string): DiffFile[] {
  // Normalize CRLF -> LF first: `git diff` on a Windows repo with CRLF files
  // emits CRLF, which leaves a trailing \r on every content line and breaks
  // parse-diff's header detection (e.g. "new file mode\r"), mis-classifying an
  // added file as renamed. Parse against LF regardless of source line endings.
  const files = parseDiff(raw.replace(/\r\n/g, "\n"));

  return files.map((f): DiffFile => {
    const path = (f.deleted ? f.from : f.to) ?? f.from ?? f.to ?? "(unknown)";
    const status: DiffFile["status"] = f.new
      ? "added"
      : f.deleted
        ? "deleted"
        : f.from && f.to && f.from !== f.to
          ? "renamed"
          : "modified";

    const hunks: DiffHunk[] = (f.chunks ?? []).map((c): DiffHunk => {
      const newStart = c.newStart ?? 0;
      const newEnd = newStart + (c.newLines ?? 0) - 1;
      const lines: DiffLine[] = (c.changes ?? []).map((ch): DiffLine => {
        const content = stripPrefix(ch.content);
        if (ch.type === "add") {
          return { type: "add", content, newNumber: (ch as { ln: number }).ln };
        }
        if (ch.type === "del") {
          return { type: "del", content, oldNumber: (ch as { ln: number }).ln };
        }
        const normal = ch as { ln1: number; ln2: number };
        return {
          type: "normal",
          content,
          oldNumber: normal.ln1,
          newNumber: normal.ln2,
        };
      });
      return { header: c.content, newStart, newEnd, lines };
    });

    return { path, status, hunks };
  });
}

/** parse-diff keeps the leading +/-/space marker on each line's content. */
function stripPrefix(content: string): string {
  if (content.length === 0) return content;
  const first = content[0];
  if (first === "+" || first === "-" || first === " ") {
    return content.slice(1);
  }
  return content;
}
