# Scribe

Hands-free voice coding agent: **speak your app into existence**.

Powered by:
- [Inworld Realtime](https://docs.inworld.ai/) (speech)
- [Cursor SDK](https://cursor.com/docs/sdk/typescript) Composer 2.5 Fast (coding)

Composer 2.5 fast was selected for [fast feedback](https://artificialanalysis.ai/agents/coding-agents#execution-time) (as of August 1st 2026).

## Voice commands

Aside from speaking your app into existence, there are other voice commands:

Testing the live preview:

| Tool | Purpose |
|------|---------|
| `click` | Click by label / text / selector |
| `type_into` | Type into a field |
| `scroll` | Scroll up or down |
| `press_key` | Press Enter, Escape, etc. |
| `create_ui_test` | Write a JSON step-script under `playground/tests/` |
| `run_ui_test` | Replay a UI test live in the preview (highlights + asserts) |

Other commands:

| Tool | Purpose |
|------|---------|
| `mute` | Mute the mic |
| `open_preview` | Open the preview in web browser |
| `undo_last_change` | Revert the last successful coding change (100 undos) |

## Setup

```bash
cp .env.example .env
# fill INWORLD_API_KEY (Portal Basic/Base64) and CURSOR_API_KEY

npm install
npm run dev
```

On first launch (or when `playground/` is missing), the app copies [`playground-template/`](playground-template/) → `playground/` and runs `npm install` there.

`postinstall` runs `scripts/ensure-electron.mjs` so the Electron binary is present even if `extract-zip` fails.

For Inworld, paste the Portal **Basic (Base64)** credential into `INWORLD_API_KEY` (not the raw key/secret pair).

Grant microphone access once. Listening starts automatically.

## New Project

**File → New Project** (⌘N / Ctrl+N) replaces `playground/` with a fresh copy of `playground-template/`. The working `playground/` directory is gitignored — only the template is tracked.

## Demo script (3 min)

1. Launch — empty playground on the right
2. “Build a simple todo app with an input, an Add button, and a delete control on each item”
3. “Run the add todo test” — preview types “buy milk”, clicks Add, asserts, deletes, asserts gone  
   (fixture: [`playground-template/tests/add-todo.json`](playground-template/tests/add-todo.json))
4. Or: “Write a UI test called add todo that types buy milk, adds it, checks it appears, deletes it, and checks it’s gone”
5. “Make completed items fade out”

## Important

Keep `import "./voice-bridge"` in [`playground-template/src/main.tsx`](playground-template/src/main.tsx). The coding agent is instructed not to remove it from the live `playground/` copy.

## License

MIT
