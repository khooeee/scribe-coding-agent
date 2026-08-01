import { useEffect, useEffectEvent, useRef, useState } from "react";
import { MicCapture, PcmPlayer } from "./audio";
import type { AgentStatus, ChatMessage, PreviewAction } from "./types";

const SPLIT_KEY = "voice-coding-agent-chat-ratio";

function loadChatRatio(): number {
  const raw = localStorage.getItem(SPLIT_KEY);
  const n = raw ? Number(raw) : 0.4;
  if (!Number.isFinite(n)) return 0.4;
  return Math.min(0.7, Math.max(0.2, n));
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>("Starting…");
  const [listening, setListening] = useState(false);
  const [heardUser, setHeardUser] = useState(false);
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

  const onChat = useEffectEvent((msg: ChatMessage) => {
    if (msg.role === "user") {
      setHeardUser(true);
      setAgentStatus((prev) =>
        prev === "Speak the app into existence..." ? "Listening..." : prev,
      );
    }
    setMessages((prev) => [...prev, msg]);
  });

  const onStatus = useEffectEvent((status: AgentStatus) => {
    setAgentStatus(status.message);
  });

  const onAudio = useEffectEvent((payload: { pcm16Base64: string }) => {
    playerRef.current ??= new PcmPlayer();
    playerRef.current.playBase64Pcm16(payload.pcm16Base64);
  });

  const reloadPreview = useEffectEvent(() => {
    const next = `${playgroundUrl}?t=${Date.now()}`;
    setPreviewSrc(next);
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
          setAgentStatus(result.error ?? "Failed to start voice");
          setListening(false);
          return;
        }
        setListening(true);
        setAgentStatus("Speak the app into existence...");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Mic permission failed";
        setAgentStatus(message);
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
              {muted
                ? "Muted"
                : listening
                  ? heardUser
                    ? "Listening..."
                    : "Speak the app into existence..."
                  : "Idle"}
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
              Arms folded after mic access — build and use the app by voice.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={`${m.at}-${i}`} className={`bubble ${m.role}`}>
              {m.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className={`agent-strip ${agentStatus.includes("Composer") ? "active" : ""}`}>
          {agentStatus}
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
          <span>Live preview</span>
          <span>{playgroundUrl}</span>
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
