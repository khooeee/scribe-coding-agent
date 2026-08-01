import { useEffect, useEffectEvent, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { MicCapture, PcmPlayer } from "./audio";
import type {
  AgentStatus,
  ChatMessage,
  IncomingChatMessage,
  PreviewAction,
} from "./types";

const SPLIT_KEY = "voice-coding-agent-chat-ratio";

function loadChatRatio(): number {
  const raw = localStorage.getItem(SPLIT_KEY);
  const n = raw ? Number(raw) : 0.4;
  if (!Number.isFinite(n)) return 0.4;
  return Math.min(0.7, Math.max(0.2, n));
}

function appendSystemMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  text: string,
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === "system" && last.text === trimmed) return prev;
    return [...prev, { role: "system", text: trimmed, at: Date.now() }];
  });
}

function appendToolsLine(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  text: string,
  statusType: AgentStatus["type"],
) {
  const trimmed = text.trim();
  if (!trimmed) return;
  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role === "tools") {
      if (last.lines[last.lines.length - 1] === trimmed) {
        return statusType === "done" || statusType === "error"
          ? [...prev.slice(0, -1), { ...last, open: false }]
          : prev;
      }
      return [
        ...prev.slice(0, -1),
        {
          ...last,
          lines: [...last.lines, trimmed],
          // Respect manual collapse; auto-collapse when the run finishes.
          open: statusType === "status" ? last.open : false,
        },
      ];
    }
    return [
      ...prev,
      {
        role: "tools",
        lines: [trimmed],
        at: Date.now(),
        open: true,
      },
    ];
  });
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [chatRatio, setChatRatio] = useState(loadChatRatio);
  const [dragging, setDragging] = useState(false);
  const [playgroundUrl, setPlaygroundUrl] = useState("http://127.0.0.1:5174");
  const [previewSrc, setPreviewSrc] = useState("http://127.0.0.1:5174");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const pendingAcks = useRef(
    new Map<string, (result: { ok: boolean; error?: string }) => void>(),
  );

  const onChat = useEffectEvent((msg: IncomingChatMessage) => {
    if (msg.role === "diff") {
      setMessages((prev) => [...prev, { ...msg, open: true }]);
      return;
    }
    setMessages((prev) => [...prev, msg]);
  });

  const onStatus = useEffectEvent((status: AgentStatus) => {
    appendToolsLine(setMessages, status.message, status.type);
  });

  const onAudio = useEffectEvent((payload: { pcm16Base64: string }) => {
    playerRef.current ??= new PcmPlayer();
    playerRef.current.playBase64Pcm16(payload.pcm16Base64);
  });

  const reloadPreview = useEffectEvent(() => {
    const next = `${playgroundUrl}?t=${Date.now()}`;
    setPreviewSrc(next);
  });

  const onSetMute = useEffectEvent((nextMuted: boolean) => {
    setMuted(nextMuted);
  });

  const handlePreviewAction = useEffectEvent((action: PreviewAction) => {
    const iframe = iframeRef.current;
    const win = iframe?.contentWindow;
    if (!win) {
      window.voiceFun.reportPreviewActionResult({
        requestId: action.requestId,
        ok: false,
        error: "Preview frame not ready",
      });
      return;
    }

    const onAck = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
        ok?: boolean;
        error?: string;
      };
      if (data?.source !== "voice-coding-agent-bridge") return;
      if (data.type !== "action-result") return;
      if (data.requestId !== action.requestId) return;
      window.removeEventListener("message", onAck);
      pendingAcks.current.delete(action.requestId);
      window.voiceFun.reportPreviewActionResult({
        requestId: action.requestId,
        ok: Boolean(data.ok),
        error: data.error,
      });
    };

    pendingAcks.current.set(action.requestId, () => undefined);
    window.addEventListener("message", onAck);
    const origin = new URL(playgroundUrl).origin;
    win.postMessage({ source: "voice-coding-agent", ...action }, origin);

    window.setTimeout(() => {
      if (!pendingAcks.current.has(action.requestId)) return;
      pendingAcks.current.delete(action.requestId);
      window.removeEventListener("message", onAck);
      window.voiceFun.reportPreviewActionResult({
        requestId: action.requestId,
        ok: false,
        error: "No ack from preview bridge",
      });
    }, 7000);
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const unsubs = [
      window.voiceFun.onChatMessage(onChat),
      window.voiceFun.onAgentStatus(onStatus),
      window.voiceFun.onAudioOut(onAudio),
      window.voiceFun.onPreviewReload(reloadPreview),
      window.voiceFun.onPreviewAction(handlePreviewAction),
      window.voiceFun.onSetMute(onSetMute),
    ];

    async function boot() {
      const config = await window.voiceFun.getConfig();
      if (cancelled) return;
      setPlaygroundUrl(config.playgroundUrl);
      setPreviewSrc(config.playgroundUrl);

      const mic = new MicCapture();
      micRef.current = mic;
      try {
        await mic.start((chunk) => window.voiceFun.sendAudio(chunk));
        const result = await window.voiceFun.startVoice();
        if (cancelled) return;
        if (result.playgroundUrl) {
          setPlaygroundUrl(result.playgroundUrl);
          setPreviewSrc(result.playgroundUrl);
        }
        if (!result.ok) {
          appendSystemMessage(setMessages, result.error ?? "Failed to start voice");
          setListening(false);
          return;
        }
        setListening(true);
        appendSystemMessage(setMessages, "Listening...");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Mic permission failed";
        appendSystemMessage(setMessages, message);
        setListening(false);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      void micRef.current?.stop();
      playerRef.current?.interrupt();
      void window.voiceFun.stopVoice();
    };
  }, []);

  useEffect(() => {
    micRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (!dragging) return;

    function onMove(event: MouseEvent) {
      const ratio = event.clientX / window.innerWidth;
      const clamped = Math.min(0.7, Math.max(0.2, ratio));
      setChatRatio(clamped);
    }

    function onUp() {
      setDragging(false);
      localStorage.setItem(SPLIT_KEY, String(chatRatio));
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, chatRatio]);

  useEffect(() => {
    if (!dragging) {
      localStorage.setItem(SPLIT_KEY, String(chatRatio));
    }
  }, [chatRatio, dragging]);

  return (
    <div className="app" style={{ ["--chat-width" as string]: `${chatRatio * 100}%` }}>
      <section className="chat-pane">
        <header className="chat-header">
          <h1 className="brand">Scribe</h1>
          <div className="status-row">
            <div className={`listening ${listening && !muted ? "on" : ""}`}>
              <span className="dot" />
              {muted ? "Muted" : listening ? "Listening..." : "Idle"}
            </div>
            <button
              type="button"
              className={`mute-btn ${muted ? "muted" : ""}`}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </header>

        <div className="messages">
          {messages.length === 0 && (
            <div className="bubble system">
              Speak your app into existence.
            </div>
          )}
          {messages.map((m, i) => {
            if (m.role === "tools") {
              return (
                <details
                  key={`${m.at}-${i}`}
                  className="tools-block"
                  open={m.open}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setMessages((prev) =>
                      prev.map((msg, idx) =>
                        idx === i && msg.role === "tools" ? { ...msg, open } : msg,
                      ),
                    );
                  }}
                >
                  <summary>
                    <span className="tools-summary-label">Tools</span>
                    <span className="tools-summary-text">
                      {m.lines[m.lines.length - 1]}
                      {m.lines.length > 1 ? ` · ${m.lines.length}` : ""}
                    </span>
                  </summary>
                  <div className="tools-lines">
                    {m.lines.map((line, li) => (
                      <div key={li} className="tools-line">
                        {line}
                      </div>
                    ))}
                  </div>
                </details>
              );
            }

            if (m.role === "diff") {
              const fileLabel =
                m.files.length === 1
                  ? m.files[0]!.path
                  : `${m.files.length} files changed`;
              return (
                <details
                  key={`${m.at}-${i}`}
                  className="diff-block"
                  open={m.open}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setMessages((prev) =>
                      prev.map((msg, idx) =>
                        idx === i && msg.role === "diff" ? { ...msg, open } : msg,
                      ),
                    );
                  }}
                >
                  <summary>
                    <span className="diff-summary-label">Diff</span>
                    <span className="diff-summary-text">{fileLabel}</span>
                  </summary>
                  <div className="diff-files">
                    {m.files.map((file) => (
                      <div key={file.path} className="diff-file">
                        <div className="diff-file-path">
                          <span className={`diff-status ${file.status}`}>{file.status}</span>
                          {file.path}
                        </div>
                        <pre className="diff-hunk">
                          {file.lines.map((line, li) => (
                            <div key={li} className={`diff-line ${line.type}`}>
                              <span className="diff-gutter">
                                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                              </span>
                              <span className="diff-code">{line.text || " "}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    ))}
                  </div>
                </details>
              );
            }

            return (
              <div key={`${m.at}-${i}`} className={`bubble ${m.role}`}>
                {m.text}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </section>

      <div
        className={`gutter ${dragging ? "dragging" : ""}`}
        onMouseDown={() => setDragging(true)}
        role="separator"
        aria-orientation="vertical"
      />

      <section className="preview-pane">
        <div className="preview-bar">
          <a
            className="preview-link"
            href={playgroundUrl}
            title="Open in default browser"
            onClick={(event) => {
              event.preventDefault();
              void window.voiceFun.openExternal(playgroundUrl);
            }}
          >
            {playgroundUrl}
          </a>
        </div>
        <iframe
          ref={iframeRef}
          className="preview-frame"
          title="Playground preview"
          src={previewSrc}
        />
      </section>
    </div>
  );
}
