import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Notification Bell — surfaces active announcements + the caller's own
 * broadcast log. Unread count is derived from `announcements/active`.
 */
export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  const nav = useNavigate();

  const reload = () => {
    if (!user) return;
    api.get("/announcements/active").then(r => setItems(r.data || [])).catch(() => {});
  };

  useEffect(() => {
    reload();
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Click outside to close
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const unread = items.filter(i => !i.read).length;

  const handleClick = async (item) => {
    setOpen(false);
    if (!item.read) {
      await api.post(`/announcements/${item.id}/read`).catch(() => {});
      reload();
    }
    if (item.cta_url) {
      if (item.cta_url.startsWith("http")) window.open(item.cta_url, "_blank", "noopener,noreferrer");
      else nav(item.cta_url);
    }
  };

  if (!user) return null;

  return (
    <div ref={ref} style={{ position: "relative" }} data-testid="notification-bell">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        data-testid="notification-bell-btn"
        style={{ position: "relative", padding: "6px 10px" }}
      >
        <span style={{ fontSize: 18 }}>🔔</span>
        {unread > 0 && (
          <span data-testid="notification-badge" style={{
            position: "absolute", top: -2, right: -2,
            background: "#dc2626", color: "#fff",
            borderRadius: "10px", padding: "1px 6px",
            fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center",
          }}>{unread}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          width: 340, maxHeight: 460, overflowY: "auto",
          background: "linear-gradient(140deg, rgba(30,25,50,0.98), rgba(20,15,35,0.98))",
          border: "1px solid var(--glass-border)", borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)", padding: 8, zIndex: 100,
        }} data-testid="notification-dropdown">
          <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--glass-border)", fontFamily: "var(--font-serif)", fontWeight: 700 }}>
            Notifications
          </div>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--white-muted)", fontSize: 13 }}>
              You're all caught up.
            </div>
          ) : items.map((it) => (
            <button key={it.id}
              onClick={() => handleClick(it)}
              data-testid={`notification-item-${it.id}`}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 12px", border: "none", cursor: "pointer",
                background: it.read ? "transparent" : "rgba(212,175,55,0.08)",
                borderRadius: 8, marginBottom: 4, color: "var(--white)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                {!it.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gold)" }} />}
                {it.title}
              </div>
              {it.body && <div style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 2 }}>{it.body}</div>}
              {it.cta_url && <div style={{ color: "var(--gold-light)", fontSize: 12, marginTop: 3 }}>{it.cta_label || "Learn more"} →</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
