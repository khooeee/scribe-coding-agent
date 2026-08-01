import { spawn, type ChildProcess } from "node:child_process";
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

export async function startPlayground(): Promise<string> {
  playgroundPort = DEFAULT_PORT;
  const playgroundPath = getPlaygroundPath();

  if (await isPortInUse(playgroundPort)) {
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

export function stopPlayground(): void {
  if (!child) return;
  child.kill("SIGTERM");
  child = null;
}
