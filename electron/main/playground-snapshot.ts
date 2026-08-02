import fs from "node:fs/promises";
import path from "node:path";
import { getPlaygroundPath } from "./playground";

export type FileMap = Map<string, string>;

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const MAX_UNDO = 100;

/** Oldest → newest. Pop restores the most recent successful coding change. */
const undoStack: FileMap[] = [];

async function walkFiles(dir: string, root: string, out: FileMap): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(abs, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = path.relative(root, abs);
    try {
      out.set(rel, await fs.readFile(abs, "utf8"));
    } catch {
      // skip unreadable files
    }
  }
}

export async function capturePlaygroundSnapshot(): Promise<FileMap> {
  const root = getPlaygroundPath();
  const map: FileMap = new Map();
  await walkFiles(root, root, map);
  return map;
}

export function commitUndoSnapshot(snapshot: FileMap): void {
  undoStack.push(snapshot);
  while (undoStack.length > MAX_UNDO) {
    undoStack.shift();
  }
}

export function hasUndoSnapshot(): boolean {
  return undoStack.length > 0;
}

export function undoStackSize(): number {
  return undoStack.length;
}

export function clearUndoSnapshot(): void {
  undoStack.length = 0;
}

export async function undoLastPlaygroundChange(): Promise<{
  ok: boolean;
  summary: string;
}> {
  const snapshot = undoStack.pop();
  if (!snapshot) {
    return { ok: false, summary: "Nothing to undo." };
  }

  const root = getPlaygroundPath();
  const current = await capturePlaygroundSnapshot();

  // Restore snapshot files.
  for (const [rel, content] of snapshot) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  // Remove files created after the snapshot.
  for (const rel of current.keys()) {
    if (snapshot.has(rel)) continue;
    try {
      await fs.unlink(path.join(root, rel));
    } catch {
      // ignore
    }
  }

  const remaining = undoStack.length;
  const summary =
    remaining > 0
      ? `Reverted the latest code change (${remaining} undo${remaining === 1 ? "" : "s"} left).`
      : "Reverted the latest code change (nothing left to undo).";
  return { ok: true, summary };
}
