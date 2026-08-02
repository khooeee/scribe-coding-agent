import type { BrowserWindow } from "electron";

export type PreviewAction =
  | { action: "click"; target: string; requestId: string }
  | { action: "type_into"; target: string; text: string; clear?: boolean; requestId: string }
  | {
      action: "scroll";
      direction: "up" | "down";
      amount?: "page" | "half" | number;
      requestId: string;
    }
  | { action: "press_key"; key: string; requestId: string }
  | { action: "assert_text"; text: string; requestId: string }
  | { action: "assert_no_text"; text: string; requestId: string }
  | { action: "assert_visible"; target: string; requestId: string }
  | { action: "wait"; ms?: number; requestId: string };

export type ActionResult = { ok: boolean; error?: string };

const pending = new Map<string, { resolve: (value: ActionResult) => void; timer: NodeJS.Timeout }>();

let getWindow: () => BrowserWindow | null = () => null;

export function setPreviewWindowGetter(fn: () => BrowserWindow | null): void {
  getWindow = fn;
}

export function resolvePreviewAction(requestId: string, result: ActionResult): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(requestId);
  entry.resolve(result);
}

export function requestPreviewAction(action: PreviewAction): Promise<ActionResult> {
  return new Promise((resolve) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) {
      resolve({ ok: false, error: "Window not available" });
      return;
    }
    const waitMs = action.action === "wait" ? Math.min(action.ms ?? 300, 5000) : 0;
    const timeoutMs = 8000 + waitMs;
    const timer = setTimeout(() => {
      pending.delete(action.requestId);
      resolve({ ok: false, error: "Preview action timed out" });
    }, timeoutMs);
    pending.set(action.requestId, { resolve, timer });
    win.webContents.send("preview:action", action);
  });
}
