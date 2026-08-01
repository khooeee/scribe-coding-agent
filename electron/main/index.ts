import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { InworldSession } from "./inworld";
import { disposeCodingAgent } from "./coding-agent";
import { getPlaygroundUrl, startPlayground, stopPlayground } from "./playground";
import { resolvePreviewAction, setPreviewWindowGetter } from "./preview-actions";
import { installAppMenu } from "./menu";

loadEnv({ path: join(process.cwd(), ".env") });

let mainWindow: BrowserWindow | null = null;
let voiceSession: InworldSession | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Scribe",
    backgroundColor: "#0f1419",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

async function startVoice(): Promise<{ ok: boolean; error?: string; playgroundUrl: string }> {
  const playgroundUrl = getPlaygroundUrl();
  try {
    if (voiceSession) {
      voiceSession.stop();
      voiceSession = null;
    }
    voiceSession = new InworldSession(() => mainWindow);
    await voiceSession.start();
    return { ok: true, playgroundUrl };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to start voice";
    return { ok: false, error, playgroundUrl };
  }
}

function registerIpc(): void {
  ipcMain.handle("app:get-config", () => ({
    playgroundUrl: getPlaygroundUrl(),
  }));

  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    if (typeof url !== "string") return { ok: false };
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("voice:start", async () => startVoice());

  ipcMain.on("voice:audio-in", (_event, payload: { pcm16Base64: string }) => {
    if (payload?.pcm16Base64) {
      voiceSession?.appendAudio(payload.pcm16Base64);
    }
  });

  ipcMain.handle("voice:stop", async () => {
    voiceSession?.stop();
    voiceSession = null;
    return { ok: true };
  });

  ipcMain.on(
    "preview:action-result",
    (_event, payload: { requestId: string; ok: boolean; error?: string }) => {
      if (!payload?.requestId) return;
      resolvePreviewAction(payload.requestId, {
        ok: Boolean(payload.ok),
        error: payload.error,
      });
    },
  );
}

app.whenReady().then(async () => {
  registerIpc();
  setPreviewWindowGetter(() => mainWindow);
  installAppMenu({ getWindow: () => mainWindow });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === "media") {
      callback(true);
      return;
    }
    callback(false);
  });

  try {
    const url = await startPlayground();
    console.log(`Playground ready at ${url}`);
  } catch (err) {
    console.error("Failed to start playground:", err);
  }

  mainWindow = createWindow();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  voiceSession?.stop();
  void disposeCodingAgent();
  stopPlayground();
});
