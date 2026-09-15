/**
 * ManagerChat — thread list + selected-thread messages + reply box.
 *
 * Iter 90b — Backend endpoints already exist in chat_routes.py + a new
 * /manager/chats/threads that lists every booking chat the manager
 * should moderate. Manager acts as a moderator: any message they send
 * lands in the thread as sender_role=manager. Privacy redaction on the
 * artist side runs on the backend.
 */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../../components/Nav";
import api, { formatApiError as fmt } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../lib/toast";


const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
};

const ROLE_TINT = {
  customer: "gold",
  artist: "purple",
  manager: "green",
  admin: "red",
};


function ThreadListItem({ thread, active, onSelect }) {
  return (
    <div
      onClick={onSelect}
      data-testid={`mc-thread-${thread.booking_id}`}
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: active ? "rgba(212,175,55,0.08)" : "transparent",
        cursor: "pointer",
        borderLeft: active ? "3px solid #D4AF37" : "3px solid transparent",
      }}
    >
      <div className="flex-between mb-4">
        <div className="fw-700 fs-13">{thread.customer_name || "—"}</div>
        {thread.unread_count > 0 && (
          <span className="pill pill-gold" style={{ fontSize: 10 }} data-testid={`mc-unread-${thread.booking_id}`}>
            {thread.unread_count} new
          </span>
        )}
      </div>
      <div className="text-muted fs-11 mb-4">
        {thread.ref} · with {thread.artist_name} · {thread.event_date}
      </div>
      {thread.last_message ? (
        <div className="fs-12" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className={`pill pill-${ROLE_TINT[thread.last_message.sender_role] || "gold"}`} style={{ fontSize: 9 }}>
            {thread.last_message.sender_role}
          </span>
          <span className="text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {thread.last_message.content}
          </span>
          <span className="text-muted fs-10">{fmtTime(thread.last_message.created_at)}</span>
        </div>
      ) : (
        <div className="text-muted fs-11">No messages yet</div>
      )}
    </div>
  );
}


function MessageBubble({ msg, isMine }) {
  const align = isMine ? "flex-end" : "flex-start";
  const bgColor = isMine ? "rgba(212,175,55,0.14)" : "rgba(255,255,255,0.04)";
  return (
    <div style={{ display: "flex", justifyContent: align, marginBottom: 10 }} data-testid={`mc-msg-${msg.id}`}>
      <div style={{ maxWidth: "72%" }}>
        {!isMine && (
          <div className="flex gap-8 fs-11 mb-4" style={{ alignItems: "center" }}>
            <span className={`pill pill-${ROLE_TINT[msg.sender_role] || "gold"}`} style={{ fontSize: 9 }}>
              {msg.sender_role}
            </span>
            <span className="text-muted">{msg.sender_name}</span>
          </div>
        )}
        <div style={{
          background: bgColor,
          padding: "10px 14px",
          borderRadius: 12,
          borderTopRightRadius: isMine ? 4 : 12,
          borderTopLeftRadius: isMine ? 12 : 4,
          fontSize: 14,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {msg.content}
        </div>
        <div className="text-muted fs-10 mt-4" style={{ textAlign: align === "flex-end" ? "right" : "left" }}>
          {fmtTime(msg.created_at)}
        </div>
      </div>
    </div>
  );
}


export default function ManagerChat() {
  const { user } = useAuth();
  const toast = useToast();
  const [threads, setThreads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);

  const loadThreads = async () => {
    try {
      const r = await api.get("/manager/chats/threads");
      setThreads(r.data.items || []);
    } catch (e) { toast(fmt(e), "error"); }
  };

  const loadMessages = async (bookingId) => {
    try {
      const r = await api.get(`/chat/${bookingId}/messages?limit=500`);
      setMessages(r.data || []);
      // Mark all as read
      await api.post(`/chat/${bookingId}/read`);
      // Refresh threads to update unread counts
      loadThreads();
    } catch (e) { toast(fmt(e), "error"); }
  };

  useEffect(() => { loadThreads(); }, []); // eslint-disable-line

  useEffect(() => {
    if (selected) loadMessages(selected.booking_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.booking_id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    if (!draft.trim() || !selected) return;
    setSending(true);
    try {
      const r = await api.post(`/chat/${selected.booking_id}/messages`, {
        content: draft.trim(), type: "text",
      });
      setMessages((prev) => [...prev, r.data]);
      setDraft("");
    } catch (e) { toast(fmt(e), "error"); }
    setSending(false);
  };

  return (
    <div>
      <Nav />
      <div className="pad-24" data-testid="manager-chat" style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="flex-between mb-16" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="text-muted fs-12" style={{ letterSpacing: ".14em", textTransform: "uppercase" }}>
              Chat Moderation
            </div>
            <h1 className="font-serif fs-28 fw-700 text-gold" data-testid="mc-title">Booking Conversations</h1>
            <div className="text-muted fs-13 mt-4">
              {threads.length > 0 ? `${threads.length} active thread${threads.length === 1 ? "" : "s"}` : "No active threads yet"}
            </div>
          </div>
          <Link to={user?.role === "admin" ? "/admin" : "/manager"} className="btn btn-ghost btn-sm">← Back</Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, height: "70vh" }}>
          {/* Thread list */}
          <div className="card" style={{ overflowY: "auto" }} data-testid="mc-thread-list">
            {threads.length === 0 && (
              <div className="pad-24 text-muted text-center fs-13" data-testid="mc-empty-threads">
                No conversations yet. When customers and artists start chatting on your assigned bookings, they'll show up here.
              </div>
            )}
            {threads.map((t) => (
              <ThreadListItem
                key={t.booking_id}
                thread={t}
                active={selected?.booking_id === t.booking_id}
                onSelect={() => setSelected(t)}
              />
            ))}
          </div>

          {/* Chat window */}
          <div className="card" style={{ display: "flex", flexDirection: "column" }} data-testid="mc-chat-window">
            {!selected ? (
              <div className="pad-24 text-muted text-center fs-13" style={{ margin: "auto" }}>
                Select a conversation on the left to view messages.
              </div>
            ) : (
              <>
                {/* Header */}
                <div style={{
                  padding: 14,
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <div className="fw-700" data-testid="mc-selected-title">
                      {selected.customer_name} ↔ {selected.artist_name}
                    </div>
                    <div className="text-muted fs-11">
                      {selected.ref} · {selected.event_date} ·{" "}
                      <Link to={`/bookings/${selected.booking_id}`} className="text-gold">View booking</Link>
                    </div>
                  </div>
                  <span className={`pill pill-${selected.status === "confirmed" ? "green" : "gold"}`}>
                    {selected.status}
                  </span>
                </div>

                {/* Messages */}
                <div ref={scrollerRef}
                     style={{ flex: 1, overflowY: "auto", padding: 16 }}
                     data-testid="mc-messages">
                  {messages.length === 0 && (
                    <div className="text-muted text-center pad-24 fs-13">
                      No messages yet. Send the first one — customer & artist will get an in-app + WhatsApp ping.
                    </div>
                  )}
                  {messages.map((m) => (
                    <MessageBubble key={m.id} msg={m} isMine={m.sender_id === user?.id} />
                  ))}
                </div>

                {/* Reply box */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: 12 }}>
                  <div className="flex gap-8">
                    <textarea
                      className="field-input"
                      placeholder="Type as manager (customer & artist will both see this)…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                      }}
                      rows={2}
                      data-testid="mc-draft"
                      style={{ flex: 1, resize: "none" }}
                    />
                    <button
                      className="btn btn-gold"
                      onClick={send}
                      disabled={sending || !draft.trim()}
                      data-testid="mc-send"
                    >
                      {sending ? "…" : "Send"}
                    </button>
                  </div>
                  <div className="text-muted fs-10 mt-4">
                    Press Enter to send · Shift+Enter for newline · Customer contact details in messages are auto-redacted.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
