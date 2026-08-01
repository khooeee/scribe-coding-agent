# Scribe

Hands-free voice coding agent: **speak your app into existence**.

Electron window with a resizable split:

- **Left** — voice chat transcript (auto-listening)
- **Right** — live playground webapp that refreshes after each coding turn

Powered by [Inworld Realtime](https://docs.inworld.ai/) (speech) and [Cursor SDK](https://cursor.com/docs/sdk/typescript) Composer 2.5 Fast (coding), plus voice UI tools (`click`, `type_into`, `scroll`, `press_key`, `mute`, `undo_last_change`).

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
2. “Build a simple todo app with a dark theme”
3. “Type buy milk into the input and press Enter”
4. “Click the delete button” / “Scroll down”
5. “Make completed items fade out”

## Voice tools

| Tool | Purpose |
|------|---------|
| `run_coding_agent` | Edit playground source with Composer |
| `undo_last_change` | Revert the latest successful coding change |
| `click` | Click by label / text / selector |
| `type_into` | Type into a field |
| `scroll` | Scroll the preview |
| `press_key` | Press Enter, Escape, etc. |
| `mute` | Mute / unmute the mic (`muted: true\|false`) |

## Important

Keep `import "./voice-bridge"` in [`playground-template/src/main.tsx`](playground-template/src/main.tsx). The coding agent is instructed not to remove it from the live `playground/` copy.

## License

MIT
