import { diffLines } from "diff";
import type { FileMap } from "./playground-snapshot";

export type DiffLine = {
  type: "add" | "del" | "context";
  text: string;
};

export type FileDiff = {
  path: string;
  status: "modified" | "added" | "deleted";
  lines: DiffLine[];
};

const MAX_FILES = 12;
const MAX_LINES_PER_FILE = 200;
const CONTEXT = 2;

function collapseContext(lines: DiffLine[]): DiffLine[] {
  // Keep only changed lines plus a little surrounding context.
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.type !== "context") {
      for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j++) {
        keep.add(j);
      }
    }
  }
  if (keep.size === 0) return [];

  const out: DiffLine[] = [];
  let last = -2;
  const sorted = [...keep].sort((a, b) => a - b);
  for (const idx of sorted) {
    if (last !== -2 && idx > last + 1) {
      out.push({ type: "context", text: "…" });
    }
    out.push(lines[idx]!);
    last = idx;
  }
  return out;
}

function diffOneFile(path: string, before: string | undefined, after: string | undefined): FileDiff | null {
  if (before === after) return null;

  if (before === undefined && after !== undefined) {
    const lines = after.split("\n").map((text) => ({ type: "add" as const, text }));
    return {
      path,
      status: "added",
      lines: lines.slice(0, MAX_LINES_PER_FILE),
    };
  }

  if (before !== undefined && after === undefined) {
    const lines = before.split("\n").map((text) => ({ type: "del" as const, text }));
    return {
      path,
      status: "deleted",
      lines: lines.slice(0, MAX_LINES_PER_FILE),
    };
  }

  const parts = diffLines(before ?? "", after ?? "");
  const raw: DiffLine[] = [];
  for (const part of parts) {
    const type: DiffLine["type"] = part.added ? "add" : part.removed ? "del" : "context";
    const chunkLines = part.value.replace(/\n$/, "").split("\n");
    // diffLines includes a trailing newline chunk sometimes as empty last line
    for (const text of chunkLines) {
      if (text === "" && chunkLines.length === 1 && part.value === "\n") {
        raw.push({ type, text: "" });
        continue;
      }
      raw.push({ type, text });
    }
  }

  const lines = collapseContext(raw).slice(0, MAX_LINES_PER_FILE);
  if (lines.length === 0) return null;
  return { path, status: "modified", lines };
}

export function buildPlaygroundDiffs(before: FileMap, after: FileMap): FileDiff[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const diffs: FileDiff[] = [];

  for (const rel of [...paths].sort()) {
    // Skip lockfiles / noise in chat
    if (rel.endsWith("package-lock.json")) continue;
    if (rel.startsWith("node_modules/") || rel.startsWith("dist/")) continue;

    const fileDiff = diffOneFile(rel, before.get(rel), after.get(rel));
    if (fileDiff) diffs.push(fileDiff);
    if (diffs.length >= MAX_FILES) break;
  }

  return diffs;
}
