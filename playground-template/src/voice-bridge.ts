/**
 * Voice UI bridge — DO NOT REMOVE.
 * Parent Electron shell posts { source: "scribe-coding-agent", action, ... } messages here.
 */

type BridgeRequest =
  | { source: "scribe-coding-agent"; action: "click"; target: string; requestId: string }
  | {
      source: "scribe-coding-agent";
      action: "type_into";
      target: string;
      text: string;
      clear?: boolean;
      requestId: string;
    }
  | {
      source: "scribe-coding-agent";
      action: "scroll";
      direction: "up" | "down";
      amount?: "page" | "half" | number;
      requestId: string;
    }
  | { source: "scribe-coding-agent"; action: "press_key"; key: string; requestId: string }
  | { source: "scribe-coding-agent"; action: "assert_text"; text: string; requestId: string }
  | { source: "scribe-coding-agent"; action: "assert_no_text"; text: string; requestId: string }
  | { source: "scribe-coding-agent"; action: "assert_visible"; target: string; requestId: string }
  | { source: "scribe-coding-agent"; action: "wait"; ms?: number; requestId: string };

const HIGHLIGHT_CLASS = "scribe-voice-highlight";
const HIGHLIGHT_STYLE_ID = "scribe-voice-highlight-style";

function ack(requestId: string, ok: boolean, error?: string) {
  window.parent.postMessage(
    { source: "scribe-coding-agent-bridge", type: "action-result", requestId, ok, error },
    "*",
  );
}

function ensureHighlightStyle(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid #3dd6c6 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(61, 214, 198, 0.35) !important;
      transition: outline 80ms ease, box-shadow 80ms ease;
    }
  `;
  document.head.appendChild(style);
}

function highlight(el: HTMLElement): void {
  ensureHighlightStyle();
  el.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 450);
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function looksLikeSelector(target: string): boolean {
  return (
    target.startsWith("#") ||
    target.startsWith(".") ||
    target.startsWith("[") ||
    /[#.\[\]>~:]/.test(target)
  );
}

function textOf(el: Element): string {
  return (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
}

function pageText(): string {
  return (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim();
}

function resolveTarget(target: string): HTMLElement | null {
  const t = target.trim();
  if (!t) return null;

  if (looksLikeSelector(t)) {
    try {
      const el = document.querySelector(t);
      if (el instanceof HTMLElement) return el;
    } catch {
      // not a valid selector
    }
  }

  const needle = normalize(t);
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a, [role='button'], input, textarea, select, [contenteditable='true']",
    ),
  );

  for (const el of candidates) {
    const aria = normalize(el.getAttribute("aria-label") || "");
    if (aria && (aria === needle || aria.includes(needle))) return el;
  }

  for (const el of candidates) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) continue;
    const text = normalize(textOf(el));
    if (text && (text === needle || text.includes(needle))) return el;
  }

  for (const label of Array.from(document.querySelectorAll("label"))) {
    if (!normalize(label.textContent || "").includes(needle)) continue;
    const forId = label.getAttribute("for");
    if (forId) {
      const el = document.getElementById(forId);
      if (el instanceof HTMLElement) return el;
    }
    const nested = label.querySelector("input, textarea, select");
    if (nested instanceof HTMLElement) return nested;
  }

  for (const el of Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  )) {
    const ph = normalize(el.getAttribute("placeholder") || "");
    const name = normalize(el.getAttribute("name") || "");
    if (ph.includes(needle) || name.includes(needle)) return el;
  }

  return null;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function doClick(target: string): { ok: boolean; error?: string } {
  const el = resolveTarget(target);
  if (!el) return { ok: false, error: `No control matching "${target}"` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  highlight(el);
  el.click();
  return { ok: true };
}

function doTypeInto(
  target: string,
  text: string,
  clear?: boolean,
): { ok: boolean; error?: string } {
  const el = resolveTarget(target);
  if (!el) return { ok: false, error: `No field matching "${target}"` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  highlight(el);
  el.focus();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, `${clear ? "" : el.value}${text}`);
    return { ok: true };
  }

  if (el.isContentEditable) {
    if (clear) el.textContent = "";
    el.textContent = `${el.textContent || ""}${text}`;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  }

  return { ok: false, error: `Target "${target}" is not a text field` };
}

function doScroll(
  direction: "up" | "down",
  amount?: "page" | "half" | number,
): { ok: boolean; error?: string } {
  let px: number;
  if (typeof amount === "number") px = amount;
  else if (amount === "half") px = window.innerHeight / 2;
  else px = window.innerHeight * 0.9;
  window.scrollBy({ top: direction === "down" ? px : -px, left: 0, behavior: "smooth" });
  return { ok: true };
}

function doPressKey(key: string): { ok: boolean; error?: string } {
  const target = (
    document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  ) as HTMLElement;
  const eventInit: KeyboardEventInit = {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
  };
  target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
  target.dispatchEvent(new KeyboardEvent("keyup", eventInit));

  if (
    key === "Enter" &&
    (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  ) {
    target.form?.requestSubmit();
  }
  return { ok: true };
}

function doAssertText(text: string): { ok: boolean; error?: string } {
  const needle = text.trim();
  if (!needle) return { ok: false, error: "assert_text requires text" };
  if (!pageText().toLowerCase().includes(needle.toLowerCase())) {
    return { ok: false, error: `Text not found: "${needle}"` };
  }
  return { ok: true };
}

function doAssertNoText(text: string): { ok: boolean; error?: string } {
  const needle = text.trim();
  if (!needle) return { ok: false, error: "assert_no_text requires text" };
  if (pageText().toLowerCase().includes(needle.toLowerCase())) {
    return { ok: false, error: `Text still present: "${needle}"` };
  }
  return { ok: true };
}

function doAssertVisible(target: string): { ok: boolean; error?: string } {
  const el = resolveTarget(target);
  if (!el) return { ok: false, error: `Not visible: "${target}"` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  highlight(el);
  return { ok: true };
}

function doWait(ms?: number): Promise<{ ok: boolean; error?: string }> {
  const delay = Math.max(0, Math.min(typeof ms === "number" ? ms : 300, 5000));
  return new Promise((resolve) => {
    window.setTimeout(() => resolve({ ok: true }), delay);
  });
}

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as BridgeRequest;
  if (!data || data.source !== "scribe-coding-agent") return;
  if (!data.action || !("requestId" in data)) return;

  void (async () => {
    try {
      if (data.action === "click") {
        const result = doClick(data.target);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "type_into") {
        const result = doTypeInto(data.target, data.text, data.clear);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "scroll") {
        const result = doScroll(data.direction, data.amount);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "press_key") {
        const result = doPressKey(data.key);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "assert_text") {
        const result = doAssertText(data.text);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "assert_no_text") {
        const result = doAssertNoText(data.text);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "assert_visible") {
        const result = doAssertVisible(data.target);
        ack(data.requestId, result.ok, result.error);
        return;
      }
      if (data.action === "wait") {
        const result = await doWait(data.ms);
        ack(data.requestId, result.ok, result.error);
      }
    } catch (err) {
      ack(data.requestId, false, err instanceof Error ? err.message : "Bridge error");
    }
  })();
});
