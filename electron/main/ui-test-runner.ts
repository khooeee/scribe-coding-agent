import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { getPlaygroundPath } from "./playground";
import { requestPreviewAction, type PreviewAction } from "./preview-actions";

export type UiTestStep =
  | { action: "click"; target: string }
  | { action: "type_into"; target: string; text: string; clear?: boolean }
  | { action: "scroll"; direction: "up" | "down"; amount?: "page" | "half" | number }
  | { action: "press_key"; key: string }
  | { action: "assert_text"; text: string }
  | { action: "assert_no_text"; text: string }
  | { action: "assert_visible"; target: string }
  | { action: "wait"; ms?: number };

export type UiTestScript = {
  name: string;
  steps: UiTestStep[];
};

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

export type UiTestResult = {
  ok: boolean;
  name: string;
  path?: string;
  passed: number;
  total: number;
  failedStep?: number;
  error?: string;
};

const STEP_GAP_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function testsDir(): string {
  return path.join(getPlaygroundPath(), "tests");
}

function stepDetail(step: UiTestStep): string {
  switch (step.action) {
    case "click":
    case "assert_visible":
      return step.target;
    case "type_into":
      return `${step.target} ← ${step.text}`;
    case "scroll":
      return step.direction;
    case "press_key":
      return step.key;
    case "assert_text":
    case "assert_no_text":
      return step.text;
    case "wait":
      return `${step.ms ?? 300}ms`;
    default:
      return "";
  }
}

function isUiTestStep(value: unknown): value is UiTestStep {
  if (!value || typeof value !== "object") return false;
  const action = (value as { action?: unknown }).action;
  return typeof action === "string";
}

function parseScript(raw: unknown, fallbackName: string): UiTestScript | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { name?: unknown; steps?: unknown };
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return null;
  if (!obj.steps.every(isUiTestStep)) return null;
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : fallbackName;
  return { name, steps: obj.steps as UiTestStep[] };
}

async function listTestFiles(): Promise<string[]> {
  const dir = testsDir();
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export async function resolveUiTest(
  query: string,
): Promise<{ ok: true; filePath: string; script: UiTestScript } | { ok: false; error: string }> {
  const files = await listTestFiles();
  if (files.length === 0) {
    return {
      ok: false,
      error: "No UI tests found. Create one under playground/tests/ first.",
    };
  }

  const needle = normalize(query);
  const slug = slugify(query);
  type Candidate = { filePath: string; script: UiTestScript; score: number };
  const candidates: Candidate[] = [];

  for (const filePath of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      continue;
    }
    const base = path.basename(filePath, ".json");
    const script = parseScript(raw, base);
    if (!script) continue;

    let score = 0;
    if (base === slug) score += 100;
    if (normalize(script.name) === needle) score += 90;
    if (base.includes(slug) || slug.includes(base)) score += 40;
    if (normalize(script.name).includes(needle) || needle.includes(normalize(script.name))) {
      score += 30;
    }
    if (score > 0) candidates.push({ filePath, script, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    const names = files.map((f) => path.basename(f, ".json")).join(", ");
    return { ok: false, error: `No UI test matching "${query}". Available: ${names || "(none)"}` };
  }
  return { ok: true, filePath: best.filePath, script: best.script };
}

function toPreviewAction(step: UiTestStep, requestId: string): PreviewAction {
  switch (step.action) {
    case "click":
      return { action: "click", target: step.target, requestId };
    case "type_into":
      return {
        action: "type_into",
        target: step.target,
        text: step.text,
        clear: step.clear,
        requestId,
      };
    case "scroll":
      return {
        action: "scroll",
        direction: step.direction,
        amount: step.amount,
        requestId,
      };
    case "press_key":
      return { action: "press_key", key: step.key, requestId };
    case "assert_text":
      return { action: "assert_text", text: step.text, requestId };
    case "assert_no_text":
      return { action: "assert_no_text", text: step.text, requestId };
    case "assert_visible":
      return { action: "assert_visible", target: step.target, requestId };
    case "wait":
      return { action: "wait", ms: step.ms, requestId };
  }
}

function sendProgress(win: BrowserWindow | null, event: TestProgressEvent): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("test:progress", event);
}

export async function runUiTest(
  query: string,
  win: BrowserWindow | null,
): Promise<UiTestResult> {
  const resolved = await resolveUiTest(query);
  if (!resolved.ok) {
    return { ok: false, name: query, passed: 0, total: 0, error: resolved.error };
  }

  const { script, filePath } = resolved;
  const total = script.steps.length;
  let passed = 0;

  sendProgress(win, {
    name: script.name,
    step: 0,
    total,
    action: "start",
    detail: path.basename(filePath),
    ok: true,
  });

  for (let i = 0; i < script.steps.length; i++) {
    const step = script.steps[i]!;
    const requestId = `ui-test-${Date.now()}-${i}`;
    const action = toPreviewAction(step, requestId);
    const result = await requestPreviewAction(action);
    const detail = stepDetail(step);

    sendProgress(win, {
      name: script.name,
      step: i + 1,
      total,
      action: step.action,
      detail,
      ok: result.ok,
      error: result.error,
    });

    if (!result.ok) {
      sendProgress(win, {
        name: script.name,
        step: i + 1,
        total,
        action: step.action,
        detail,
        ok: false,
        error: result.error,
        done: true,
      });
      return {
        ok: false,
        name: script.name,
        path: filePath,
        passed,
        total,
        failedStep: i + 1,
        error: result.error ?? `Step ${i + 1} failed (${step.action})`,
      };
    }

    passed += 1;
    if (i < script.steps.length - 1) {
      await sleep(STEP_GAP_MS);
    }
  }

  sendProgress(win, {
    name: script.name,
    step: total,
    total,
    action: "done",
    ok: true,
    done: true,
  });

  return {
    ok: true,
    name: script.name,
    path: filePath,
    passed,
    total,
  };
}

export function uiTestSlug(name: string): string {
  return slugify(name) || "ui-test";
}

export function uiTestPrompt(name: string, prompt: string): string {
  const slug = uiTestSlug(name);
  const file = `tests/${slug}.json`;
  return [
    `Create or update the UI step-script test at ${file}.`,
    `Test display name: ${name}`,
    "",
    "User request:",
    prompt,
    "",
    "Requirements:",
    `- Write ONLY ${file} (create the tests/ directory if needed). Do not change app UI source.`,
    "- File must be JSON with shape: { \"name\": string, \"steps\": Step[] }",
    "- Allowed step actions: click, type_into, scroll, press_key, assert_text, assert_no_text, assert_visible, wait",
    "- Prefer label/text targets (e.g. \"Add\", \"Delete\", placeholder fragments) over brittle CSS selectors.",
    "- Include asserts so the test verifies the outcome, not only interactions.",
    "- Keep voice-bridge.ts and its import untouched.",
    "",
    "Example shape:",
    JSON.stringify(
      {
        name: "Add a todo",
        steps: [
          { action: "assert_visible", target: "Add" },
          { action: "type_into", target: "todo", text: "buy milk", clear: true },
          { action: "click", target: "Add" },
          { action: "assert_text", text: "buy milk" },
          { action: "click", target: "Delete" },
          { action: "assert_no_text", text: "buy milk" },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}
