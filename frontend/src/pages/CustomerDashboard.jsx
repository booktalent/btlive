import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError, API } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import ChatBox from "../components/ChatBox";

export default function CustomerDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [bookings, setBookings] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [reviewModal, setReviewModal] = useState(null);

  useEffect(() => {
    if (!user) { nav("/login"); return; }
    if (user.role === "artist") { nav("/artist"); return; }
    if (user.role === "admin") { nav("/admin"); return; }
    refresh();
    // `refresh` is defined below in the same render — adding it would cause a
    // new closure each render → infinite re-fetch. `nav` from react-router is
    // stable per its own docs. Intentional narrow dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const refresh = async () => {
    const [b, a] = await Promise.all([
      api.get("/bookings/mine"),
      api.get("/analytics/me"),
    ]);
    setBookings(b.data);
    setAnalytics(a.data);
  };

  const doAction = async (bid, action) => {
    try {
      await api.post(`/bookings/${bid}/action`, { action });
      toast("Booking updated");
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  const submitReview = async (booking_id, rating, text, photos = [], videos = []) => {
    try {
      const r = await api.post("/reviews", { booking_id, rating, text, photos, videos });
      toast(r.data.status === "pending" ? "Review submitted — awaiting moderation" : "Review published!");
      setReviewModal(null);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  if (!user) return null;

  return (
    <div className="dash-wrap" data-testid="customer-dashboard">
      <aside className="sidebar">
        <Link to="/" className="logo mb-20" data-testid="dash-logo">
          <div className="logo-mark">B</div>
          <span style={{ fontSize: 18 }}>Book<span className="gold">Talent</span></span>
        </Link>
        <div className="sb-section">Main</div>
        {[
          { id: "overview", label: "📊 Overview" },
          { id: "bookings", label: "🎟️ My Bookings" },
          { id: "reviews", label: "⭐ Reviews" },
          { id: "messages", label: "💬 Messages" },
        ].map((x) => (
          <div key={x.id} className={`sb-item ${tab === x.id ? "active" : ""}`} onClick={() => setTab(x.id)} data-testid={`sb-${x.id}`}>
            {x.label}
          </div>
        ))}
        <div className="sb-section">Discover</div>
        <Link to="/search" className="sb-item">🔍 Find Artists</Link>
      </aside>

      <main className="dash-content">
        <Nav />
        <div style={{ marginTop: 18 }}>
          <div className="dash-head">
            <div>
              <h1>Welcome, {user.first_name}</h1>
              <p>Manage your bookings and reviews</p>
            </div>
            <Link to="/search" className="btn btn-gold btn-sm" data-testid="cust-find-artists">+ Book Artist</Link>
          </div>

          <div className="kpi-grid">
            <Kpi icon="🎟️" cls="kpi-icon-purple" num={analytics.total_bookings || 0} label="Total Bookings" />
            <Kpi icon="✅" cls="kpi-icon-green" num={analytics.completed || 0} label="Completed" />
            <Kpi icon="📅" cls="kpi-icon-amber" num={analytics.upcoming || 0} label="Upcoming" />
            <Kpi icon="💰" cls="kpi-icon-gold" num={fmtINRFull(analytics.total_spent || 0)} label="Total Spent" />
          </div>

          {tab === "overview" && (
            <div className="card" data-testid="cust-overview">
              <div className="card-head"><div className="card-title">📋 Recent Bookings</div></div>
              <BookingsTable bookings={bookings.slice(0, 6)} role="customer" onAction={doAction} onReview={setReviewModal} />
            </div>
          )}

          {tab === "bookings" && (
            <div className="card" data-testid="cust-bookings">
              <div className="card-head"><div className="card-title">🎟️ All Bookings</div></div>
              <BookingsTable bookings={bookings} role="customer" onAction={doAction} onReview={setReviewModal} />
            </div>
          )}

          {tab === "reviews" && <CustReviews bookings={bookings.filter(b => b.status === "reviewed")} />}

          {tab === "messages" && <Messages />}
        </div>
      </main>

      {reviewModal && <ReviewModal booking={reviewModal} onSubmit={submitReview} onClose={() => setReviewModal(null)} />}
    </div>
  );
}

const Kpi = ({ icon, cls, num, label, change }) => (
  <div className="kpi" data-testid={`kpi-${label.replace(/\s+/g, "-").toLowerCase()}`}>
    <div className="kpi-top">
      <div className={`kpi-icon ${cls}`}>{icon}</div>
      {change && <span className="kpi-change kpi-change-up">{change}</span>}
    </div>
    <div className="kpi-num">{num}</div>
    <div className="kpi-label">{label}</div>
  </div>
);

const STATUS_MAP = {
  pending_payment: ["sp-pending", "Pending payment"],
  pending_artist: ["sp-pending", "Awaiting artist"],
  confirmed: ["sp-confirmed", "Confirmed"],
  started: ["sp-confirmed", "In progress"],
  completed_by_artist: ["sp-pending", "Pending approval"],
  completed: ["sp-completed", "Completed"],
  reviewed: ["sp-completed", "Reviewed"],
  rejected: ["sp-rejected", "Rejected"],
  cancelled: ["sp-rejected", "Cancelled"],
};

export function BookingsTable({ bookings, role, onAction, onReview }) {
  const [chatBooking, setChatBooking] = useState(null);

  // Lock body scroll + scroll to top when a chat opens so the modal is always
  // visible (otherwise the modal-bg dim appears but the modal-card lands above
  // the viewport on long lists, which users perceive as "Chat shows an empty
  // faded screen for a long time").
  useEffect(() => {
    if (chatBooking) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      window.scrollTo({ top: 0, behavior: "smooth" });
      return () => { document.body.style.overflow = prev; };
    }
  }, [chatBooking]);

  if (bookings.length === 0) {
    return <div className="empty"><div className="empty-icon">📋</div><div className="empty-title">No bookings yet</div></div>;
  }

  const downloadPdf = async (url, filename) => {
    const token = localStorage.getItem("bt_token");
    const r = await fetch(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { alert("Download failed"); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = window.URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="table-wrap">
      <table className="table" data-testid="bookings-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Event</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => {
            const [pillCls, label] = STATUS_MAP[b.status] || ["sp-pending", b.status];
            const showContract = b.contract_id && ["confirmed", "started", "completed_by_artist", "completed", "reviewed"].includes(b.status);
            return (
              <tr key={b.id} data-testid={`booking-row-${b.id}`}>
                <td className="font-mono fs-11" style={{ color: "var(--gold-light)" }}>{b.ref}</td>
                <td>
                  <div className="fw-600">{b.event_type}</div>
                  <div className="text-muted fs-11">{b.venue}, {b.city}</div>
                  {(b.special_instructions || "").trim() && (
                    <div className="text-muted fs-11 mt-4" title={b.special_instructions} data-testid={`si-preview-${b.id}`} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      📝 {b.special_instructions}
                    </div>
                  )}
                </td>
                <td className="fs-12">{b.event_date}<br/><span className="text-muted">{b.event_time}</span></td>
                <td className="text-gold font-serif fs-18 fw-700">{fmtINRFull(b.pricing?.total || 0)}</td>
                <td><span className={`status-pill ${pillCls}`}>{label}</span></td>
                <td>
                  <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                    {role === "artist" && b.status === "pending_artist" && (
                      <>
                        <button className="btn btn-green btn-xs" onClick={() => onAction(b.id, "accept")} data-testid={`accept-${b.id}`}>Accept</button>
                        <button className="btn btn-purple btn-xs" onClick={() => onAction(b.id, "counter")} data-testid={`counter-${b.id}`}>Counter</button>
                        <button className="btn btn-red btn-xs" onClick={() => onAction(b.id, "reject")} data-testid={`reject-${b.id}`}>Reject</button>
                      </>
                    )}
                    {role === "artist" && b.status === "confirmed" && (
                      <button className="btn btn-purple btn-xs" onClick={() => onAction(b.id, "complete")} data-testid={`complete-${b.id}`}>Mark Complete</button>
                    )}
                    {role === "customer" && b.status === "completed_by_artist" && (
                      <button className="btn btn-green btn-xs" onClick={() => onAction(b.id, "approve_completion")} data-testid={`approve-${b.id}`}>Approve</button>
                    )}
                    {role === "customer" && b.status === "completed" && (
                      <button className="btn btn-gold btn-xs" onClick={() => onReview(b)} data-testid={`review-${b.id}`}>⭐ Review</button>
                    )}
                    {role === "customer" && ["pending_artist", "confirmed"].includes(b.status) && (
                      <button className="btn btn-red btn-xs" onClick={() => onAction(b.id, "cancel")} data-testid={`cancel-${b.id}`}>Cancel</button>
                    )}
                    {showContract && (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => downloadPdf(`/contracts/${b.contract_id}/pdf`, `contract_${b.ref}.pdf`)}
                        data-testid={`dl-contract-${b.id}`}
                        title="Download Contract PDF"
                      >📄 Contract</button>
                    )}
                    {b.amount_paid > 0 && (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => downloadPdf(`/bookings/${b.id}/invoice`, `invoice_${b.ref}.pdf`)}
                        data-testid={`dl-invoice-${b.id}`}
                        title="Download Invoice PDF"
                      >🧾 Invoice</button>
                    )}
                    {(() => {
                      // Chat is locked ONLY for fresh, unpaid booking requests
                      // (status === "pending_payment" + payment_status === "unpaid").
                      // Every booking past that gate (legacy or new) keeps chat open.
                      const ps = b.payment_status;
                      const isPendingPayment = b.status === "pending_payment";
                      const isUnpaid = ps === "unpaid" || ps === undefined && isPendingPayment;
                      const chatUnlocked = !isPendingPayment && !isUnpaid;
                      return (
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => setChatBooking(b)}
                          disabled={!chatUnlocked}
                          data-testid={`chat-${b.id}`}
                          title={chatUnlocked
                            ? "Open chat"
                            : "Chat will be available after successful payment of the Platform Service Fee."}
                          style={!chatUnlocked ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                        >
                          {chatUnlocked ? "💬 Chat" : "🔒 Pay to Unlock Chat"}
                        </button>
                      );
                    })()}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {chatBooking && (
        <div className="modal-bg" onClick={() => setChatBooking(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, padding: 0 }}>
            <ChatBox
              bookingId={chatBooking.id}
              otherName={role === "customer" ? (chatBooking.artist_name || "Artist") : (chatBooking.customer_name || "Customer")}
              paymentStatus={chatBooking.payment_status}
              height={520}
            />
            <div style={{ padding: 10, textAlign: "right" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setChatBooking(null)} data-testid="chat-close">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewModal({ booking, onSubmit, onClose }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [busy, setBusy] = useState(false);

  const readFile = (f) => new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(f);
  });

  const onPhotos = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    const oversize = files.find((f) => f.size > 5 * 1024 * 1024);
    if (oversize) { alert("Each photo must be under 5 MB"); return; }
    const urls = await Promise.all(files.map(readFile));
    setPhotos(urls);
  };

  const onVideos = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 2);
    const oversize = files.find((f) => f.size > 30 * 1024 * 1024);
    if (oversize) { alert("Each video must be under 30 MB"); return; }
    const urls = await Promise.all(files.map(readFile));
    setVideos(urls);
  };

  const submit = async () => {
    setBusy(true);
    try { await onSubmit(booking.id, rating, text, photos, videos); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose} data-testid="review-modal">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Leave a Review</div>
        <div className="modal-sub">{booking.event_type} · {booking.event_date}</div>
        <div className="field">
          <div className="field-label">Your Rating</div>
          <div style={{ display: "flex", gap: 6, fontSize: 32, cursor: "pointer" }} data-testid="rating-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} onClick={() => setRating(n)} style={{ color: n <= rating ? "var(--gold)" : "var(--white-dim)" }} data-testid={`star-${n}`}>★</span>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="field-label">Your Review</div>
          <textarea className="field-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Share your experience…" data-testid="review-text" />
        </div>
        <div className="field">
          <div className="field-label">Photos (up to 5, max 5 MB each — will be moderated)</div>
          <input type="file" accept="image/*" multiple onChange={onPhotos} data-testid="review-photos" />
          {photos.length > 0 && <div className="pill pill-green mt-8">✓ {photos.length} photo(s) attached</div>}
        </div>
        <div className="field">
          <div className="field-label">Videos (up to 2, max 30 MB each — will be moderated)</div>
          <input type="file" accept="video/*" multiple onChange={onVideos} data-testid="review-videos" />
          {videos.length > 0 && <div className="pill pill-green mt-8">✓ {videos.length} video(s) attached</div>}
        </div>
        {(photos.length > 0 || videos.length > 0) && (
          <div className="text-muted fs-11 mb-8">Reviews with media go to moderation queue (24-48 h).</div>
        )}
        <div className="flex gap-12 mt-16">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={submit} disabled={!text || busy} data-testid="submit-review">
            {busy ? "Submitting..." : "Submit Review"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustReviews() {
  return (
    <div className="card card-pad" data-testid="reviews-tab">
      <div className="empty">
        <div className="empty-icon">⭐</div>
        <div className="empty-title">Your Reviews</div>
        <p>Reviews you've left for completed bookings will appear here.</p>
      </div>
    </div>
  );
}

function Messages() {
  const [convos, setConvos] = useState([]);
  useEffect(() => { api.get("/conversations").then((r) => setConvos(r.data)); }, []);
  return (
    <div className="card" data-testid="messages-tab">
      <div className="card-head"><div className="card-title">💬 Conversations</div></div>
      <div style={{ padding: 14 }}>
        {convos.length === 0 ? <div className="empty"><div className="empty-icon">💬</div><div className="empty-title">No conversations yet</div></div> :
          convos.map((c) => (
            <div key={c.id} className="card card-pad mb-12" data-testid={`convo-${c.id}`}>
              <div className="fw-600">{c.other?.first_name} {c.other?.last_name}</div>
              <div className="text-muted fs-12">{c.last_message}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
