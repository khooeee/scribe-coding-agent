import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";

const DEFAULT_PORT = Number(process.env.PLAYGROUND_PORT ?? 5174);

let child: ChildProcess | null = null;
let playgroundPort = DEFAULT_PORT;

export function getPlaygroundUrl(): string {
  return `http://127.0.0.1:${playgroundPort}`;
}

export function getPlaygroundPath(): string {
  return path.join(process.cwd(), "playground");
}

export function getPlaygroundTemplatePath(): string {
  return path.join(process.cwd(), "playground-template");
}

function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitUntilListening(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortInUse(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Playground did not start on port ${port}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function npmInstall(cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("npm", ["install"], {
      cwd,
      stdio: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: true,
    });
    proc.stdout?.on("data", (buf) => {
      const line = String(buf).trim();
      if (line) console.log(`[playground:npm] ${line}`);
    });
    proc.stderr?.on("data", (buf) => {
      const line = String(buf).trim();
      if (line) console.error(`[playground:npm] ${line}`);
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed with code ${code}`));
    });
    proc.on("error", reject);
  });
}

/** Copy playground-template → playground (excluding node_modules/dist). */
export async function createProjectFromTemplate(): Promise<void> {
  const template = getPlaygroundTemplatePath();
  const dest = getPlaygroundPath();

  if (!(await pathExists(template))) {
    throw new Error(`Template not found at ${template}`);
  }

  stopPlayground();
  // Give the process a moment to release the port / cwd.
  await new Promise((r) => setTimeout(r, 300));

  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(template, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      return base !== "node_modules" && base !== "dist";
    },
  });

  await npmInstall(dest);
}

export async function ensurePlaygroundExists(): Promise<void> {
  if (await pathExists(getPlaygroundPath())) return;
  await createProjectFromTemplate();
}

export async function startPlayground(): Promise<string> {
  playgroundPort = DEFAULT_PORT;
  await ensurePlaygroundExists();
  const playgroundPath = getPlaygroundPath();

  if (child) {
    return getPlaygroundUrl();
  }

  if (await isPortInUse(playgroundPort)) {
    // Another process is already serving — reuse it.
    return getPlaygroundUrl();
  }

  child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(playgroundPort), "--strictPort"],
    {
      cwd: playgroundPath,
      stdio: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: true,
    },
  );

  child.stdout?.on("data", (buf) => {
    const line = String(buf).trim();
    if (line) console.log(`[playground] ${line}`);
  });
  child.stderr?.on("data", (buf) => {
    const line = String(buf).trim();
    if (line) console.error(`[playground] ${line}`);
  });
  child.on("exit", (code) => {
    console.log(`[playground] exited with code ${code}`);
    child = null;
  });

  await waitUntilListening(playgroundPort);
  return getPlaygroundUrl();
}

export async function restartPlayground(): Promise<string> {
  stopPlayground();
  await new Promise((r) => setTimeout(r, 400));
  // If something else still holds the port, wait a bit more.
  const start = Date.now();
  while ((await isPortInUse(playgroundPort)) && Date.now() - start < 5000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  return startPlayground();
}

export function stopPlayground(): void {
  if (!child) return;
  child.kill("SIGTERM");
  child = null;
}
