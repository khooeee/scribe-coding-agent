export type TextChatMessage = {
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
};

export type ToolsChatMessage = {
  role: "tools";
  lines: string[];
  at: number;
  /** Whether the tools/reasoning block is expanded */
  open: boolean;
};

export type ChatMessage = TextChatMessage | ToolsChatMessage;

export type AgentStatus = {
  type: "status" | "error" | "done";
  message: string;
};

export type PreviewAction =
  | { action: "click"; target: string; requestId: string }
  | { action: "type_into"; target: string; text: string; clear?: boolean; requestId: string }
  | { action: "scroll"; direction: "up" | "down"; amount?: "page" | "half" | number; requestId: string }
  | { action: "press_key"; key: string; requestId: string };

export type VoiceFunApi = {
  getConfig: () => Promise<{ playgroundUrl: string }>;
  openExternal: (url: string) => Promise<{ ok: boolean }>;
  startVoice: () => Promise<{ ok: boolean; error?: string; playgroundUrl: string }>;
  stopVoice: () => Promise<{ ok: boolean }>;
  sendAudio: (pcm16Base64: string) => void;
  reportPreviewActionResult: (result: {
    requestId: string;
    ok: boolean;
    error?: string;
  }) => void;
  onChatMessage: (cb: (msg: TextChatMessage) => void) => () => void;
  onAgentStatus: (cb: (status: AgentStatus) => void) => () => void;
  onAudioOut: (cb: (payload: { pcm16Base64: string }) => void) => () => void;
  onPreviewReload: (cb: () => void) => () => void;
  onPreviewAction: (cb: (action: PreviewAction) => void) => () => void;
  onSetMute: (cb: (muted: boolean) => void) => () => void;
};
