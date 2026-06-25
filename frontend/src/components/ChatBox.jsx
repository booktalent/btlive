import React, { useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Live chat box for a booking. Connects to /api/ws/chat/{bookingId} for realtime
 * messages, typing indicators, and read receipts. Falls back to REST polling
 * if the WebSocket fails.
 */
export default function ChatBox({ bookingId, otherName = "Counterparty", height = 420 }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const wsRef = useRef(null);
  const listRef = useRef(null);
  const typingTimer = useRef(null);

  // Load history
  const loadHistory = async () => {
    try {
      const r = await api.get(`/chat/${bookingId}/messages?limit=200`);
      setMessages(r.data || []);
      // Mark as read
      api.post(`/chat/${bookingId}/read`).catch(() => {});
    } catch (_e) { /* ignore */ }
  };
  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, [bookingId]);

  // WebSocket
  useEffect(() => {
    if (!bookingId || !user) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    const base = (api.defaults.baseURL || "").replace(/^http/, "ws");
    const url = `${base}/ws/chat/${bookingId}?token=${encodeURIComponent(token)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (_e) {
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (evt) => {
      let data;
      try { data = JSON.parse(evt.data); } catch (_e) { return; }
      if (data.event === "message") {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      } else if (data.event === "typing" && data.by !== user.id) {
        setTyping(data.name || "Typing");
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(null), 2500);
      } else if (data.event === "read") {
        setMessages((prev) => prev.map((m) => {
          if (m.sender_id === user.id && !(m.read_by || []).includes(data.by)) {
            return { ...m, read_by: [...(m.read_by || []), data.by] };
          }
          return m;
        }));
      } else if (data.event === "presence") {
        setParticipants(data.participants || []);
      }
    };
    return () => {
      try { ws.close(); } catch (_e) { /* */ }
    };
  }, [bookingId, user]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = () => {
    const content = draft.trim();
    if (!content) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: "message", content }));
    } else {
      // Fallback REST
      api.post(`/chat/${bookingId}/messages`, { content })
        .then((r) => setMessages((prev) => [...prev, r.data]))
        .catch(() => {});
    }
    setDraft("");
  };

  const onTyping = (v) => {
    setDraft(v);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ event: "typing" })); } catch (_e) { /* */ }
    }
  };

  return (
    <div className="card" data-testid="chat-box" style={{ display: "flex", flexDirection: "column", height }}>
      <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="card-title">💬 Chat with {otherName}</div>
        <div className="flex gap-8 items-center">
          <span className={`pill ${connected ? "pill-green" : "pill-amber"}`} data-testid="chat-status">
            {connected ? "● Live" : "○ Reconnecting"}
          </span>
          <span className="text-muted fs-11">{participants.length} online</span>
        </div>
      </div>

      <div
        ref={listRef}
        style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="text-muted fs-13" style={{ textAlign: "center", padding: 40 }}>
            No messages yet. Say hello! 👋
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          const readByOther = (m.read_by || []).filter((u) => u !== m.sender_id).length > 0;
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%" }} data-testid={`chat-msg-${m.id}`}>
              <div
                style={{
                  background: mine ? "linear-gradient(135deg, var(--gold), var(--gold-dim))" : "var(--glass)",
                  color: mine ? "#1a1a1a" : "var(--white)",
                  padding: "8px 12px", borderRadius: 12,
                  borderTopRightRadius: mine ? 4 : 12,
                  borderTopLeftRadius: mine ? 12 : 4,
                  fontSize: 14, lineHeight: 1.4,
                  wordBreak: "break-word",
                }}
              >
                {m.content}
              </div>
              <div className="fs-10 text-muted" style={{ marginTop: 2, textAlign: mine ? "right" : "left" }}>
                {!mine && <span style={{ marginRight: 6 }}>{m.sender_name}</span>}
                {m.created_at?.slice(11, 16)}
                {mine && <span style={{ marginLeft: 4 }} data-testid={`chat-read-${m.id}`}>{readByOther ? "✓✓" : "✓"}</span>}
              </div>
            </div>
          );
        })}
        {typing && (
          <div className="text-muted fs-12" data-testid="chat-typing" style={{ alignSelf: "flex-start", fontStyle: "italic" }}>
            {typing} is typing…
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--glass-border)" }}>
        <input
          className="field-input"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => onTyping(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1 }}
          data-testid="chat-input"
        />
        <button className="btn btn-gold" onClick={send} disabled={!draft.trim()} data-testid="chat-send">Send</button>
      </div>
    </div>
  );
}
