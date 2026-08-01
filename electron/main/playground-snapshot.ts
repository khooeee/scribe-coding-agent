import fs from "node:fs/promises";
import path from "node:path";
import { getPlaygroundPath } from "./playground";

export type FileMap = Map<string, string>;

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

let lastSnapshot: FileMap | null = null;

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
  lastSnapshot = snapshot;
}

export function hasUndoSnapshot(): boolean {
  return lastSnapshot !== null;
}

export async function undoLastPlaygroundChange(): Promise<{
  ok: boolean;
  summary: string;
}> {
  if (!lastSnapshot) {
    return { ok: false, summary: "Nothing to undo." };
  }

  const root = getPlaygroundPath();
  const snapshot = lastSnapshot;
  lastSnapshot = null;

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

  return { ok: true, summary: "Reverted the latest code change." };
}
