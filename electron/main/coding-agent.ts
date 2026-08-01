import { Agent, CursorAgentError, type SDKAgent } from "@cursor/sdk";
import { getPlaygroundPath } from "./playground";

export type AgentStatusEvent = {
  type: "status" | "error" | "done";
  message: string;
  filesTouched?: string[];
};

type StatusEmitter = (event: AgentStatusEvent) => void;

let agent: SDKAgent | null = null;

export async function ensureCodingAgent(): Promise<SDKAgent> {
  if (agent) return agent;

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not set");
  }

  agent = await Agent.create({
    apiKey,
    model: {
      id: "composer-2.5",
      params: [{ id: "fast", value: "true" }],
    },
    local: { cwd: getPlaygroundPath() },
  });

  return agent;
}

export async function runCodingAgent(
  prompt: string,
  emit: StatusEmitter,
): Promise<{ ok: boolean; summary: string; filesTouched: string[] }> {
  emit({ type: "status", message: "Composer is working…" });

  try {
    const codingAgent = await ensureCodingAgent();
    const fullPrompt = [
      prompt,
      "",
      "Constraints:",
      "- You are editing a Vite webapp in this workspace that is live-previewed.",
      "- Do NOT remove the import of ./voice-bridge from the app entry (main.tsx / main.ts / main.jsx).",
      "- Keep voice-bridge.ts intact so voice UI tools keep working.",
      "- Prefer small, focused changes that make the UI visibly improve.",
    ].join("\n");

    const run = await codingAgent.send(fullPrompt);
    const filesTouched = new Set<string>();

    try {
      for await (const event of run.stream()) {
        if (event.type === "assistant") {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text.trim()) {
              emit({ type: "status", message: block.text.trim().slice(0, 160) });
            }
            if (block.type === "tool_use") {
              emit({ type: "status", message: `Using ${block.name}…` });
            }
          }
        } else if (event.type === "tool_call") {
          emit({ type: "status", message: `${event.name} (${event.status})` });
          if (event.name === "editToolCall" || event.name === "writeToolCall") {
            const args = event.args as { path?: string; file_path?: string } | undefined;
            const filePath = args?.path ?? args?.file_path;
            if (filePath) filesTouched.add(filePath);
          }
        } else if (event.type === "thinking" && event.text.trim()) {
          emit({ type: "status", message: event.text.trim().slice(0, 160) });
        }
      }
    } catch {
      // Streaming is optional; wait() is authoritative.
    }

    const result = await run.wait();
    const files = [...filesTouched];

    if (result.status === "error") {
      const summary = "The coding agent hit an error while editing.";
      emit({ type: "error", message: summary, filesTouched: files });
      return { ok: false, summary, filesTouched: files };
    }

    const summary =
      (typeof result.result === "string" && result.result.trim()) || "Updated the webapp.";
    emit({ type: "done", message: summary, filesTouched: files });
    return { ok: true, summary: summary.slice(0, 500), filesTouched: files };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      const summary = `Coding agent failed to start: ${err.message}`;
      emit({ type: "error", message: summary });
      return { ok: false, summary, filesTouched: [] };
    }
    const summary = err instanceof Error ? err.message : "Unknown coding agent error";
    emit({ type: "error", message: summary });
    return { ok: false, summary, filesTouched: [] };
  }
}

export async function disposeCodingAgent(): Promise<void> {
  if (!agent) return;
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    // ignore dispose errors
  }
  agent = null;
}
