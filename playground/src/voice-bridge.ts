/**
 * Voice UI bridge — DO NOT REMOVE.
 * Parent Electron shell posts { source: "voice-fun", action, ... } messages here.
 */

type BridgeRequest =
  | { source: "voice-fun"; action: "click"; target: string; requestId: string }
  | {
      source: "voice-fun";
      action: "type_into";
      target: string;
      text: string;
      clear?: boolean;
      requestId: string;
    }
  | {
      source: "voice-fun";
      action: "scroll";
      direction: "up" | "down";
      amount?: "page" | "half" | number;
      requestId: string;
    }
  | { source: "voice-fun"; action: "press_key"; key: string; requestId: string };

function ack(requestId: string, ok: boolean, error?: string) {
  window.parent.postMessage(
    { source: "voice-fun-bridge", type: "action-result", requestId, ok, error },
    "*",
  );
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

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as BridgeRequest;
  if (!data || data.source !== "voice-fun") return;
  if (!data.action || !("requestId" in data)) return;

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
    }
  } catch (err) {
    ack(data.requestId, false, err instanceof Error ? err.message : "Bridge error");
  }
});
