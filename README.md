# Voice Coding Agent

Hands-free voice coding agent: **speak an app into existence**.

Electron window with a resizable split:

- **Left** — voice chat transcript (auto-listening)
- **Right** — live playground webapp that refreshes after each coding turn

Powered by [Inworld Realtime](https://docs.inworld.ai/) (speech) and [Cursor SDK](https://cursor.com/docs/sdk/typescript) Composer 2.5 Fast (coding), plus voice UI tools (`click`, `type_into`, `scroll`, `press_key`).

## Setup

```bash
cp .env.example .env
# fill INWORLD_API_KEY and CURSOR_API_KEY

npm install
cd playground && npm install && cd ..
npm run dev
```

`postinstall` runs `scripts/ensure-electron.mjs` so the Electron binary is present even if `extract-zip` fails.

For Inworld, paste the Portal **Basic (Base64)** credential into `INWORLD_API_KEY` (not the raw key/secret pair). Auth is `Authorization: Basic …` on the server WebSocket.

Grant microphone access once. Listening starts automatically.

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
| `click` | Click by label / text / selector |
| `type_into` | Type into a field |
| `scroll` | Scroll the preview |
| `press_key` | Press Enter, Escape, etc. |

## Important

Keep `import "./voice-bridge"` in [`playground/src/main.tsx`](playground/src/main.tsx). The coding agent is instructed not to remove it.

## License

MIT
