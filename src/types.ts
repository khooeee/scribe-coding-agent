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

export type DiffLine = {
  type: "add" | "del" | "context";
  text: string;
};

export type FileDiff = {
  path: string;
  status: "modified" | "added" | "deleted";
  lines: DiffLine[];
};

export type DiffChatMessage = {
  role: "diff";
  files: FileDiff[];
  at: number;
  open: boolean;
};

export type ChatMessage = TextChatMessage | ToolsChatMessage | DiffChatMessage;

export type AgentStatus = {
  type: "status" | "error" | "done";
  message: string;
};

export type PreviewAction =
  | { action: "click"; target: string; requestId: string }
  | { action: "type_into"; target: string; text: string; clear?: boolean; requestId: string }
  | { action: "scroll"; direction: "up" | "down"; amount?: "page" | "half" | number; requestId: string }
  | { action: "press_key"; key: string; requestId: string }
  | { action: "assert_text"; text: string; requestId: string }
  | { action: "assert_no_text"; text: string; requestId: string }
  | { action: "assert_visible"; target: string; requestId: string }
  | { action: "wait"; ms?: number; requestId: string };

export type TestProgressEvent = {
  name: string;
  step: number;
  total: number;
  action: string;
  detail?: string;
  ok: boolean;
  error?: string;
  done?: boolean;
};

export type IncomingChatMessage = TextChatMessage | Omit<DiffChatMessage, "open">;

export type ScribeApi = {
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
  onChatMessage: (cb: (msg: IncomingChatMessage) => void) => () => void;
  onAgentStatus: (cb: (status: AgentStatus) => void) => () => void;
  onAudioOut: (cb: (payload: { pcm16Base64: string }) => void) => () => void;
  onVoiceInterrupt: (cb: () => void) => () => void;
  onPreviewReload: (cb: () => void) => () => void;
  onPreviewAction: (cb: (action: PreviewAction) => void) => () => void;
  onTestProgress: (cb: (event: TestProgressEvent) => void) => () => void;
  onSetMute: (cb: (muted: boolean) => void) => () => void;
  onProjectReset: (cb: (payload: { playgroundUrl: string }) => void) => () => void;
};
