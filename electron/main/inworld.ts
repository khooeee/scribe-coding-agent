import WebSocket from "ws";
import { BrowserWindow } from "electron";
import { runCodingAgent } from "./coding-agent";
import { requestPreviewAction } from "./preview-actions";

const INWORLD_URL = "wss://api.inworld.ai/api/v1/realtime/session";

type ChatRole = "user" | "assistant" | "system";

const SESSION_INSTRUCTIONS = `You are a hands-free voice pair-programmer. The user speaks apps into existence.

Always speak and respond in English only. Do not switch languages.

A live webapp preview is on the right. You have two kinds of tools:

BUILD — run_coding_agent: edit the playground source to create or change the UI.
OPERATE — click, type_into, scroll, press_key: interact with the already-running preview.
MIC — mute: mute or unmute the user's microphone in this app.

Classify intent:
- "Add a delete button" / "make a todo app" / "change the theme" → run_coding_agent
- "Click delete" / "type milk into the input" / "scroll down" / "press Enter" → UI tools
- "Mute" / "unmute" / "stop listening" → mute
Prefer UI tools when the control already exists. Do not rebuild for simple interactions.
Act immediately without asking for confirmation.
Keep spoken replies short (one or two sentences) so the user can keep dictating.`;

function tools() {
  return [
    {
      type: "function",
      name: "run_coding_agent",
      description:
        "Edit the live playground webapp source with Composer. Use for building or changing UI/features.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Clear coding instruction for what to build or change.",
          },
        },
        required: ["prompt"],
      },
    },
    {
      type: "function",
      name: "click",
      description: "Click a control in the live preview by name, label, text, or CSS selector.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description:
              'Accessible name, button text, label, placeholder, or CSS selector (e.g. "Delete", "#submit").',
          },
        },
        required: ["target"],
      },
    },
    {
      type: "function",
      name: "type_into",
      description: "Type text into an input, textarea, or contenteditable in the live preview.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Field label, placeholder, name, or CSS selector.",
          },
          text: { type: "string", description: "Text to type." },
          clear: {
            type: "boolean",
            description: "If true, clear the field before typing.",
          },
        },
        required: ["target", "text"],
      },
    },
    {
      type: "function",
      name: "scroll",
      description: "Scroll the live preview page up or down.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down"] },
          amount: {
            description: 'Scroll distance: "page", "half", or pixel number.',
            anyOf: [{ type: "string", enum: ["page", "half"] }, { type: "number" }],
          },
        },
        required: ["direction"],
      },
    },
    {
      type: "function",
      name: "press_key",
      description:
        "Press a keyboard key in the live preview (Enter, Escape, Tab, Backspace, arrows, etc.).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: 'Key name, e.g. "Enter", "Escape", "Tab".' },
        },
        required: ["key"],
      },
    },
    {
      type: "function",
      name: "mute",
      description:
        "Mute or unmute the user's microphone in this Electron app (not the preview webapp).",
      parameters: {
        type: "object",
        properties: {
          muted: {
            type: "boolean",
            description: "True to mute the mic, false to unmute.",
          },
        },
        required: ["muted"],
      },
    },
  ];
}

function sendChat(win: BrowserWindow | null, role: ChatRole, text: string) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("chat:message", { role, text, at: Date.now() });
}

function sendAgentStatus(
  win: BrowserWindow | null,
  message: string,
  kind: "status" | "error" | "done" = "status",
) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("agent:status", { type: kind, message });
}

function sendAudioDelta(win: BrowserWindow | null, base64Pcm: string) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("voice:audio", { pcm16Base64: base64Pcm });
}

function sendReload(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("preview:reload");
}

function sendMute(win: BrowserWindow | null, muted: boolean) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("voice:set-mute", { muted });
}

export class InworldSession {
  private ws: WebSocket | null = null;
  private closed = false;
  private assistantBuffer = "";
  private getWindow: () => BrowserWindow | null;
  /** Outstanding tool_call_ids waiting for function_call_output */
  private pendingToolCalls = new Set<string>();
  private toolChain: Promise<void> = Promise.resolve();
  private interruptsDisabled = false;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  async start(): Promise<void> {
    // Portal "Basic (Base64)" credential — already base64(key:secret). Do not re-encode.
    let apiKey = (process.env.INWORLD_API_KEY ?? "").trim();
    if (apiKey.toLowerCase().startsWith("basic ")) {
      apiKey = apiKey.slice(6).trim();
    }
    if (!apiKey) {
      throw new Error("INWORLD_API_KEY is not set");
    }

    const voice = process.env.INWORLD_VOICE ?? "Clive";
    const sessionId = `voice-${Date.now()}`;
    const url = `${INWORLD_URL}?key=${encodeURIComponent(sessionId)}&protocol=realtime`;

    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Basic ${apiKey}`,
        },
      });

      this.ws.on("open", () => {
        sendChat(this.getWindow(), "system", "Voice session connected.");
        resolve();
      });

      this.ws.on("error", (err) => {
        sendChat(this.getWindow(), "system", `Voice error: ${err.message}`);
        reject(err);
      });

      this.ws.on("close", () => {
        if (!this.closed) {
          sendChat(this.getWindow(), "system", "Voice session disconnected.");
        }
      });

      this.ws.on("message", (raw) => {
        void this.onMessage(raw.toString());
      });
    });

    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: "openai/gpt-4o-mini",
        instructions: SESSION_INSTRUCTIONS,
        output_modalities: ["audio", "text"],
        tools: tools(),
        tool_choice: "auto",
        // We explicitly send response.create after every tool result.
        providerData: {
          auto_tool_response: false,
          stt: {
            language_hints: ["en-US"],
          },
          tts: {
            language: "en-US",
          },
        },
        audio: {
          input: {
            transcription: {
              model: "inworld/inworld-stt-1",
              language: "en",
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: true,
              // Barge-in while a tool_call is unanswered corrupts OpenAI history.
              interrupt_response: true,
            },
          },
          output: {
            model: "inworld-tts-2",
            voice,
          },
        },
      },
    });
  }

  private setToolsBusy(busy: boolean): void {
    if (this.interruptsDisabled === busy) return;
    this.interruptsDisabled = busy;
    // While a tool_call is unanswered, do NOT auto-create a new model response
    // from VAD — OpenAI requires every tool_call_id to get a tool message first.
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: !busy,
              interrupt_response: !busy,
            },
          },
        },
      },
    });
  }

  appendAudio(base64Pcm: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.send({
      type: "input_audio_buffer.append",
      audio: base64Pcm,
    });
  }

  stop(): void {
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }

  private sendFunctionOutput(callId: string, output: unknown): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
  }

  private completeToolCall(callId: string, output: unknown): void {
    if (!callId) return;
    this.sendFunctionOutput(callId, output);
    this.pendingToolCalls.delete(callId);
    if (this.pendingToolCalls.size === 0) {
      this.setToolsBusy(false);
      // Continue the assistant turn with tool results in context.
      this.send({ type: "response.create" });
    }
  }

  private async onMessage(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(event.type ?? "");

    // If the user starts speaking while tools are unanswered, keep interrupts off
    // until every tool_call_id has a function_call_output (OpenAI requirement).
    if (type === "input_audio_buffer.speech_started" && this.pendingToolCalls.size > 0) {
      sendAgentStatus(
        this.getWindow(),
        "Still finishing a tool — hang tight before the next request…",
      );
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(event.transcript ?? "").trim();
      if (transcript) sendChat(this.getWindow(), "user", transcript);
      return;
    }

    // Some realtime stacks nest transcription on the item.
    if (type === "conversation.item.created") {
      const item = event.item as
        | { type?: string; role?: string; content?: Array<{ type?: string; transcript?: string }> }
        | undefined;
      if (item?.type === "message" && item.role === "user") {
        const transcript = item.content?.find((c) => c.transcript)?.transcript?.trim();
        if (transcript) sendChat(this.getWindow(), "user", transcript);
      }
      return;
    }

    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta"
    ) {
      this.assistantBuffer += String(event.delta ?? "");
      return;
    }

    if (type === "response.output_text.delta" || type === "response.text.delta") {
      this.assistantBuffer += String(event.delta ?? "");
      return;
    }

    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      const delta = String(event.delta ?? "");
      if (delta) sendAudioDelta(this.getWindow(), delta);
      return;
    }

    if (
      type === "response.done" ||
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const text = this.assistantBuffer.trim();
      if (text) {
        sendChat(this.getWindow(), "assistant", text);
        this.assistantBuffer = "";
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const callId = String(event.call_id ?? "");
      const name = String(event.name ?? "");
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(event.arguments ?? "{}")) as Record<string, unknown>;
      } catch {
        args = {};
      }

      if (!callId) {
        sendChat(this.getWindow(), "system", "Tool call missing call_id — skipped.");
        return;
      }

      this.pendingToolCalls.add(callId);
      this.setToolsBusy(true);

      // Serialize tool execution so multiple calls in one turn complete in order,
      // and every call_id gets an output before response.create.
      this.toolChain = this.toolChain
        .then(() => this.handleTool(callId, name, args))
        .catch((err) => {
          const error = err instanceof Error ? err.message : "Tool failed";
          this.completeToolCall(callId, { ok: false, error });
        });
      return;
    }

    if (type === "error") {
      const message =
        typeof event.error === "object" && event.error && "message" in event.error
          ? String((event.error as { message: string }).message)
          : "Inworld error";
      sendChat(this.getWindow(), "system", message);

      // If the router rejected history, clear our local pending set so we can recover.
      if (message.includes("tool_call") || message.includes("tool_calls")) {
        this.pendingToolCalls.clear();
        this.setToolsBusy(false);
      }
    }
  }

  private async handleTool(
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const win = this.getWindow();
    const requestId = `${callId}-${Date.now()}`;

    try {
      if (name === "run_coding_agent") {
        const prompt = String(args.prompt ?? "").trim();
        if (!prompt) {
          this.completeToolCall(callId, { ok: false, error: "Missing prompt" });
          return;
        }
        sendAgentStatus(win, "Composer is working…");
        const result = await runCodingAgent(prompt, (evt) => {
          sendAgentStatus(win, evt.message, evt.type);
        });
        if (result.ok) {
          sendReload(win);
        }
        this.completeToolCall(callId, {
          ok: result.ok,
          summary: result.summary,
          filesTouched: result.filesTouched,
        });
        return;
      }

      if (name === "click") {
        const result = await requestPreviewAction({
          action: "click",
          target: String(args.target ?? ""),
          requestId,
        });
        this.completeToolCall(callId, result);
        return;
      }

      if (name === "type_into") {
        const result = await requestPreviewAction({
          action: "type_into",
          target: String(args.target ?? ""),
          text: String(args.text ?? ""),
          clear: Boolean(args.clear),
          requestId,
        });
        this.completeToolCall(callId, result);
        return;
      }

      if (name === "scroll") {
        const direction = args.direction === "up" ? "up" : "down";
        const amount = args.amount as "page" | "half" | number | undefined;
        const result = await requestPreviewAction({
          action: "scroll",
          direction,
          amount,
          requestId,
        });
        this.completeToolCall(callId, result);
        return;
      }

      if (name === "press_key") {
        const result = await requestPreviewAction({
          action: "press_key",
          key: String(args.key ?? ""),
          requestId,
        });
        this.completeToolCall(callId, result);
        return;
      }

      if (name === "mute") {
        const muted = Boolean(args.muted);
        sendMute(win, muted);
        sendChat(win, "system", muted ? "Microphone muted." : "Microphone unmuted.");
        this.completeToolCall(callId, { ok: true, muted });
        return;
      }

      this.completeToolCall(callId, { ok: false, error: `Unknown tool: ${name}` });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Tool failed";
      this.completeToolCall(callId, { ok: false, error });
    }
  }
}
