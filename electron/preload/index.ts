import { contextBridge, ipcRenderer } from "electron";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  text: string;
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
};

contextBridge.exposeInMainWorld("voiceFun", api);

export type VoiceFunApi = typeof api;
