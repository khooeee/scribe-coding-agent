import WebSocket from "ws";
import { BrowserWindow, shell } from "electron";
import { runCodingAgent } from "./coding-agent";
import { requestPreviewAction } from "./preview-actions";
import {
  capturePlaygroundSnapshot,
  undoLastPlaygroundChange,
} from "./playground-snapshot";
import { buildPlaygroundDiffs, type FileDiff } from "./file-diff";
import { getPlaygroundUrl } from "./playground";
import { runUiTest, uiTestPrompt } from "./ui-test-runner";

const INWORLD_URL = "wss://api.inworld.ai/api/v1/realtime/session";

type ChatRole = "user" | "assistant" | "system";

type OutgoingChatMessage =
  | { role: ChatRole; text: string; at: number }
  | { role: "diff"; files: FileDiff[]; at: number };

const SESSION_INSTRUCTIONS = `You are a hands-free voice pair-programmer. The user speaks apps into existence.

Always speak and respond in English only. Do not switch languages.

A live webapp preview is on the right. You have these tools:

BUILD — run_coding_agent: edit the playground source to create or change the UI.
UNDO — undo_last_change: revert the playground one successful coding change at a time (up to 100 steps).
OPERATE — click, type_into, scroll, press_key: interact with the already-running preview.
TEST — create_ui_test: write a JSON step-script under playground/tests/; run_ui_test: replay it live in the preview.
PREVIEW — open_preview: open the live playground in the user's default web browser.
MIC — mute: mute or unmute the user's microphone in this app.

Classify intent:
- "Add a delete button" / "make a todo app" / "change the theme" → run_coding_agent
- "Undo" / "undo that" / "revert the last change" / "go back" → undo_last_change
- "Click delete" / "type milk into the input" / "scroll down" / "press Enter" → UI tools
- "Write a UI test…" / "create a test that…" → create_ui_test
- "Run the add todo test" / "run the UI test" → run_ui_test
- "Open preview" / "open in browser" / "open in web browser" / "show in browser" → open_preview
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
    {
      type: "function",
      name: "undo_last_change",
      description:
        "Undo the latest successful coding-agent change to the playground webapp (restore previous source and refresh the preview). Can be called repeatedly; up to 100 prior changes are kept.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      type: "function",
      name: "open_preview",
      description:
        'Open the live playground preview in the user\'s default web browser. Use for "open preview", "open in browser", "open in web browser", or "show in browser".',
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      type: "function",
      name: "create_ui_test",
      description:
        'Create or update a JSON UI step-script test under playground/tests/. Use for "write a UI test", "create a test that…". Writes the test file via the coding agent; does not change app UI.',
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: 'Short test name, e.g. "Add a todo" or "add-todo".',
          },
          prompt: {
            type: "string",
            description: "What the test should do and assert, in plain language.",
          },
          run_after: {
            type: "boolean",
            description: "If true, run the test live in the preview after creating it.",
          },
        },
        required: ["name", "prompt"],
      },
    },
    {
      type: "function",
      name: "run_ui_test",
      description:
        'Run a saved UI step-script test live in the preview (highlights + asserts). Use for "run the add todo test", "run the UI test".',
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Test name or filename slug to run, e.g. \"add todo\".",
          },
        },
        required: ["name"],
      },
    },
  ];
}

function sendChat(win: BrowserWindow | null, role: ChatRole, text: string) {
  if (!win || win.isDestroyed()) return;
  const msg: OutgoingChatMessage = { role, text, at: Date.now() };
  win.webContents.send("chat:message", msg);
}

function sendDiff(win: BrowserWindow | null, files: FileDiff[]) {
  if (!win || win.isDestroyed() || files.length === 0) return;
  const msg: OutgoingChatMessage = { role: "diff", files, at: Date.now() };
  win.webContents.send("chat:message", msg);
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

function sendVoiceInterrupt(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("voice:interrupt");
}

export class InworldSession {
  private ws: WebSocket | null = null;
  private closed = false;
  private assistantBuffer = "";
  private getWindow: () => BrowserWindow | null;
  /** Outstanding tool_call_ids waiting for function_call_output */
  private pendingToolCalls = new Set<string>();
  private answeredToolCalls = new Set<string>();
  private toolChain: Promise<void> = Promise.resolve();
  /** Bumps on barge-in so in-flight tools cannot write late outputs */
  private toolEpoch = 0;
  private toolsBusy = false;
  /** True between response.created and response.done */
  private responseInFlight = false;
  /** True once the current/last response requested any tools */
  private awaitingToolFollowUp = false;
  /** Drop TTS deltas after barge-in until the next response.created */
  private suppressAudio = false;

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
    if (this.toolsBusy === busy) return;
    this.toolsBusy = busy;
    // While a tool_call is unanswered, do NOT auto-create a new model response
    // from VAD — OpenAI requires every tool_call_id to get a tool message first.
    // Keep interrupt_response on so barge-in works; we repair tool history on speech_started.
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
              interrupt_response: true,
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

  private noteToolCall(callId: string): void {
    if (!callId || this.answeredToolCalls.has(callId)) return;
    this.pendingToolCalls.add(callId);
    this.awaitingToolFollowUp = true;
    this.responseInFlight = true;
    this.setToolsBusy(true);
  }

  private completeToolCall(callId: string, output: unknown, epoch: number): void {
    if (!callId || epoch !== this.toolEpoch) return;
    if (this.answeredToolCalls.has(callId)) {
      this.pendingToolCalls.delete(callId);
      this.maybeContinueAfterTools();
      return;
    }
    this.sendFunctionOutput(callId, output);
    this.answeredToolCalls.add(callId);
    this.pendingToolCalls.delete(callId);
    this.maybeContinueAfterTools();
  }

  /**
   * OpenAI requires every tool_call_id to be answered before the next model turn.
   * Fast tools can finish before later function_call events (or response.done)
   * arrive — never response.create until the response is finished AND pending is empty.
   */
  private maybeContinueAfterTools(): void {
    if (this.pendingToolCalls.size > 0 || this.responseInFlight) return;
    if (!this.awaitingToolFollowUp) {
      this.setToolsBusy(false);
      return;
    }
    this.awaitingToolFollowUp = false;
    // Keep VAD auto-response off until this follow-up begins; response.created
    // will keep busy true if more tools appear, otherwise response.done clears it.
    this.send({ type: "response.create" });
  }

  /** Answer every unanswered tool_call_id so a barge-in turn can proceed. */
  private cancelUnansweredTools(reason: string, extraIds: string[] = []): void {
    this.toolEpoch += 1;
    const ids = new Set([...this.pendingToolCalls, ...extraIds]);
    for (const callId of ids) {
      if (!callId || this.answeredToolCalls.has(callId)) continue;
      this.sendFunctionOutput(callId, { ok: false, error: reason });
      this.answeredToolCalls.add(callId);
    }
    this.pendingToolCalls.clear();
    this.awaitingToolFollowUp = false;
    this.responseInFlight = false;
    this.assistantBuffer = "";
    this.setToolsBusy(false);
  }

  private recoverMissingToolOutputs(message: string): void {
    const fromError = message.match(/call_[A-Za-z0-9]+/g) ?? [];
    this.cancelUnansweredTools("Tool call interrupted; no result available.", fromError);
  }

  private collectFunctionCallIds(event: Record<string, unknown>): string[] {
    const response = event.response as
      | { output?: Array<{ type?: string; call_id?: string }> }
      | undefined;
    const ids: string[] = [];
    for (const item of response?.output ?? []) {
      if (item?.type === "function_call" && item.call_id) ids.push(item.call_id);
    }
    return ids;
  }

  private handleUserInterrupt(): void {
    this.suppressAudio = true;
    sendVoiceInterrupt(this.getWindow());
    this.assistantBuffer = "";
    if (this.pendingToolCalls.size > 0 || this.awaitingToolFollowUp) {
      this.cancelUnansweredTools("Interrupted by user.");
      sendAgentStatus(this.getWindow(), "Interrupted — listening for your next request…");
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

    // Barge-in: stop local playback and answer any open tool_calls before the
    // next model turn (OpenAI rejects history with unanswered tool_call_ids).
    if (type === "input_audio_buffer.speech_started") {
      this.handleUserInterrupt();
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
        | {
            type?: string;
            role?: string;
            call_id?: string;
            content?: Array<{ type?: string; transcript?: string }>;
          }
        | undefined;
      if (item?.type === "function_call" && item.call_id) {
        this.noteToolCall(item.call_id);
        return;
      }
      if (item?.type === "message" && item.role === "user") {
        const transcript = item.content?.find((c) => c.transcript)?.transcript?.trim();
        if (transcript) sendChat(this.getWindow(), "user", transcript);
      }
      return;
    }

    if (type === "response.created") {
      this.responseInFlight = true;
      this.suppressAudio = false;
      return;
    }

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = event.item as { type?: string; call_id?: string } | undefined;
      if (item?.type === "function_call" && item.call_id) {
        this.noteToolCall(item.call_id);
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
      if (this.suppressAudio) return;
      const delta = String(event.delta ?? "");
      if (delta) sendAudioDelta(this.getWindow(), delta);
      return;
    }

    // Per-sentence transcript.done events must NOT flush chat — that splits one
    // spoken reply (especially after tool calls) into multiple bubbles.
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      return;
    }

    if (type === "response.cancelled") {
      const ids = this.collectFunctionCallIds(event);
      for (const id of ids) this.noteToolCall(id);
      this.cancelUnansweredTools("Interrupted by user.", ids);
      return;
    }

    if (type === "response.done") {
      this.responseInFlight = false;
      const response = event.response as { status?: string } | undefined;
      const ids = this.collectFunctionCallIds(event);

      if (response?.status === "cancelled" || response?.status === "incomplete") {
        this.cancelUnansweredTools("Interrupted by user.", ids);
        return;
      }

      // Track any call_ids we missed, but do not mark the response in-flight again
      // (that would block maybeContinueAfterTools forever).
      for (const id of ids) {
        if (!id || this.answeredToolCalls.has(id)) continue;
        this.pendingToolCalls.add(id);
        this.awaitingToolFollowUp = true;
        this.setToolsBusy(true);
      }

      const text = this.assistantBuffer.trim();
      if (text) {
        sendChat(this.getWindow(), "assistant", text);
        this.assistantBuffer = "";
      }
      this.maybeContinueAfterTools();
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

      this.noteToolCall(callId);
      if (this.answeredToolCalls.has(callId)) return;
      const epoch = this.toolEpoch;

      // Serialize tool execution so multiple calls in one turn complete in order,
      // and every call_id gets an output before response.create.
      this.toolChain = this.toolChain
        .then(() => this.handleTool(callId, name, args, epoch))
        .catch((err) => {
          const error = err instanceof Error ? err.message : "Tool failed";
          this.completeToolCall(callId, { ok: false, error }, epoch);
        });
      return;
    }

    if (type === "error") {
      const message =
        typeof event.error === "object" && event.error && "message" in event.error
          ? String((event.error as { message: string }).message)
          : "Inworld error";
      sendChat(this.getWindow(), "system", message);

      // Repair OpenAI history by answering any missing tool_call_ids, then unblock.
      if (message.includes("tool_call") || message.includes("tool_calls")) {
        this.recoverMissingToolOutputs(message);
      }
    }
  }

  private async handleTool(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    epoch: number,
  ): Promise<void> {
    if (epoch !== this.toolEpoch) return;

    const win = this.getWindow();
    const requestId = `${callId}-${Date.now()}`;

    try {
      if (name === "run_coding_agent") {
        const prompt = String(args.prompt ?? "").trim();
        if (!prompt) {
          this.completeToolCall(callId, { ok: false, error: "Missing prompt" }, epoch);
          return;
        }
        sendAgentStatus(win, "Composer is working…");
        const result = await runCodingAgent(prompt, (evt) => {
          if (epoch !== this.toolEpoch) return;
          sendAgentStatus(win, evt.message, evt.type);
        });
        if (epoch !== this.toolEpoch) return;
        if (result.ok) {
          sendReload(win);
          sendDiff(win, result.diffs);
        }
        this.completeToolCall(
          callId,
          {
            ok: result.ok,
            summary: result.summary,
            filesTouched: result.filesTouched,
          },
          epoch,
        );
        return;
      }

      if (name === "click") {
        const result = await requestPreviewAction({
          action: "click",
          target: String(args.target ?? ""),
          requestId,
        });
        this.completeToolCall(callId, result, epoch);
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
        this.completeToolCall(callId, result, epoch);
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
        this.completeToolCall(callId, result, epoch);
        return;
      }

      if (name === "press_key") {
        const result = await requestPreviewAction({
          action: "press_key",
          key: String(args.key ?? ""),
          requestId,
        });
        this.completeToolCall(callId, result, epoch);
        return;
      }

      if (name === "mute") {
        const muted = Boolean(args.muted);
        sendMute(win, muted);
        sendChat(win, "system", muted ? "Microphone muted." : "Microphone unmuted.");
        this.completeToolCall(callId, { ok: true, muted }, epoch);
        return;
      }

      if (name === "undo_last_change") {
        sendAgentStatus(win, "Undoing latest code change…");
        const beforeUndo = await capturePlaygroundSnapshot();
        const result = await undoLastPlaygroundChange();
        if (epoch !== this.toolEpoch) return;
        if (result.ok) {
          const afterUndo = await capturePlaygroundSnapshot();
          sendReload(win);
          sendDiff(win, buildPlaygroundDiffs(beforeUndo, afterUndo));
          sendAgentStatus(win, result.summary, "done");
        } else {
          sendAgentStatus(win, result.summary, "error");
        }
        this.completeToolCall(callId, result, epoch);
        return;
      }

      if (name === "open_preview") {
        const url = getPlaygroundUrl();
        try {
          await shell.openExternal(url);
          sendChat(win, "system", `Opened preview in browser: ${url}`);
          this.completeToolCall(callId, { ok: true, url }, epoch);
        } catch (err) {
          const error = err instanceof Error ? err.message : "Failed to open browser";
          this.completeToolCall(callId, { ok: false, error }, epoch);
        }
        return;
      }

      if (name === "run_ui_test") {
        const testName = String(args.name ?? "").trim();
        if (!testName) {
          this.completeToolCall(callId, { ok: false, error: "Missing test name" }, epoch);
          return;
        }
        sendAgentStatus(win, `Running UI test “${testName}”…`);
        const result = await runUiTest(testName, win);
        if (epoch !== this.toolEpoch) return;
        if (result.ok) {
          sendAgentStatus(
            win,
            `UI test passed: ${result.name} (${result.passed}/${result.total})`,
            "done",
          );
          sendChat(win, "system", `UI test passed: ${result.name}`);
        } else {
          const detail =
            result.failedStep != null
              ? ` failed at step ${result.failedStep}: ${result.error ?? "unknown error"}`
              : `: ${result.error ?? "unknown error"}`;
          sendAgentStatus(win, `UI test failed: ${result.name}${detail}`, "error");
          sendChat(win, "system", `UI test failed: ${result.name}${detail}`);
        }
        this.completeToolCall(callId, result, epoch);
        return;
      }

      if (name === "create_ui_test") {
        const testName = String(args.name ?? "").trim();
        const prompt = String(args.prompt ?? "").trim();
        const runAfter = Boolean(args.run_after);
        if (!testName || !prompt) {
          this.completeToolCall(callId, { ok: false, error: "Missing name or prompt" }, epoch);
          return;
        }
        sendAgentStatus(win, `Creating UI test “${testName}”…`);
        const result = await runCodingAgent(uiTestPrompt(testName, prompt), (evt) => {
          if (epoch !== this.toolEpoch) return;
          sendAgentStatus(win, evt.message, evt.type);
        });
        if (epoch !== this.toolEpoch) return;
        if (result.ok) {
          sendDiff(win, result.diffs);
          sendAgentStatus(win, result.summary, "done");
        } else {
          sendAgentStatus(win, result.summary, "error");
          this.completeToolCall(callId, {
            ok: false,
            summary: result.summary,
            filesTouched: result.filesTouched,
          }, epoch);
          return;
        }

        if (runAfter) {
          sendAgentStatus(win, `Running UI test “${testName}”…`);
          const runResult = await runUiTest(testName, win);
          if (epoch !== this.toolEpoch) return;
          if (runResult.ok) {
            sendAgentStatus(
              win,
              `UI test passed: ${runResult.name} (${runResult.passed}/${runResult.total})`,
              "done",
            );
            sendChat(win, "system", `UI test passed: ${runResult.name}`);
          } else {
            const detail =
              runResult.failedStep != null
                ? ` failed at step ${runResult.failedStep}: ${runResult.error ?? "unknown error"}`
                : `: ${runResult.error ?? "unknown error"}`;
            sendAgentStatus(win, `UI test failed: ${runResult.name}${detail}`, "error");
            sendChat(win, "system", `UI test failed: ${runResult.name}${detail}`);
          }
          this.completeToolCall(
            callId,
            { ok: result.ok && runResult.ok, created: result, run: runResult },
            epoch,
          );
          return;
        }

        this.completeToolCall(callId, {
          ok: true,
          summary: result.summary,
          filesTouched: result.filesTouched,
        }, epoch);
        return;
      }

      this.completeToolCall(callId, { ok: false, error: `Unknown tool: ${name}` }, epoch);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Tool failed";
      this.completeToolCall(callId, { ok: false, error }, epoch);
    }
  }
}
