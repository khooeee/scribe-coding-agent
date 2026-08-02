import { contextBridge, ipcRenderer } from "electron";

export type DiffLine = {
  type: "add" | "del" | "context";
  text: string;
};

export type FileDiff = {
  path: string;
  status: "modified" | "added" | "deleted";
  lines: DiffLine[];
};

export type ChatMessage =
  | {
      role: "user" | "assistant" | "system";
      text: string;
      at: number;
    }
  | {
      role: "diff";
      files: FileDiff[];
      at: number;
    };

export type AgentStatus = {
  type: "status" | "error" | "done";
  message: string;
};

export type PreviewAction =
  | { action: "click"; target: string; requestId: string }
  | { action: "type_into"; target: string; text: string; clear?: boolean; requestId: string }
  | { action: "scroll"; direction: "up" | "down"; amount?: "page" | "half" | number; requestId: string }
  | { action: "press_key"; key: string; requestId: string };

const api = {
  getConfig: (): Promise<{ playgroundUrl: string }> => ipcRenderer.invoke("app:get-config"),

  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("shell:open-external", url),

  startVoice: (): Promise<{ ok: boolean; error?: string; playgroundUrl: string }> =>
    ipcRenderer.invoke("voice:start"),

  stopVoice: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("voice:stop"),

  sendAudio: (pcm16Base64: string): void => {
    ipcRenderer.send("voice:audio-in", { pcm16Base64 });
  },

  reportPreviewActionResult: (result: {
    requestId: string;
    ok: boolean;
    error?: string;
  }): void => {
    ipcRenderer.send("preview:action-result", result);
  },

  onChatMessage: (cb: (msg: ChatMessage) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, msg: ChatMessage) => cb(msg);
    ipcRenderer.on("chat:message", handler);
    return () => ipcRenderer.removeListener("chat:message", handler);
  },

  onAgentStatus: (cb: (status: AgentStatus) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, status: AgentStatus) => cb(status);
    ipcRenderer.on("agent:status", handler);
    return () => ipcRenderer.removeListener("agent:status", handler);
  },

  onAudioOut: (cb: (payload: { pcm16Base64: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { pcm16Base64: string }) => cb(payload);
    ipcRenderer.on("voice:audio", handler);
    return () => ipcRenderer.removeListener("voice:audio", handler);
  },

  onVoiceInterrupt: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("voice:interrupt", handler);
    return () => ipcRenderer.removeListener("voice:interrupt", handler);
  },

  onPreviewReload: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on("preview:reload", handler);
    return () => ipcRenderer.removeListener("preview:reload", handler);
  },

  onPreviewAction: (cb: (action: PreviewAction) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, action: PreviewAction) => cb(action);
    ipcRenderer.on("preview:action", handler);
    return () => ipcRenderer.removeListener("preview:action", handler);
  },

  onSetMute: (cb: (muted: boolean) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { muted: boolean }) => {
      cb(Boolean(payload?.muted));
    };
    ipcRenderer.on("voice:set-mute", handler);
    return () => ipcRenderer.removeListener("voice:set-mute", handler);
  },

  onProjectReset: (cb: (payload: { playgroundUrl: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { playgroundUrl: string }) =>
      cb(payload);
    ipcRenderer.on("project:reset", handler);
    return () => ipcRenderer.removeListener("project:reset", handler);
  },
};

contextBridge.exposeInMainWorld("scribeApi", api);

export type ScribeApi = typeof api;
