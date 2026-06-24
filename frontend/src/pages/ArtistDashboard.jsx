import React, { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError, mediaUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { BookingsTable } from "./CustomerDashboard";

const SIDEBAR = [
  { id: "overview", label: "📊 Overview" },
  { id: "profile", label: "👤 Profile" },
  { id: "packages", label: "📦 Packages" },
  { id: "media", label: "🎬 Media" },
  { id: "calendar", label: "📅 Availability" },
  { id: "bookings", label: "🎟️ Bookings" },
  { id: "wallet", label: "💰 Wallet" },
  { id: "reviews", label: "⭐ Reviews" },
  { id: "boost", label: "🚀 Boost Profile" },
  { id: "kyc", label: "🪪 KYC" },
];

export default function ArtistDashboard() {
  const { user, refreshMe } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState({ bookings: [], packages: [], media: [], analytics: {}, wallet: {}, txns: [], reviews: [] });

  useEffect(() => {
    if (!user) { nav("/login"); return; }
    if (user.role !== "artist") { nav(user.role === "admin" ? "/admin" : "/customer"); return; }
    refresh();
    // eslint-disable-next-line
  }, [user]);

  const refresh = async () => {
    const [b, p, m, a, w, t, r] = await Promise.all([
      api.get("/bookings/mine"),
      api.get("/packages/mine"),
      api.get("/media"),
      api.get("/analytics/me"),
      api.get("/wallet"),
      api.get("/wallet/transactions"),
      api.get(`/reviews/artist/${user.id}`),
    ]);
    setData({ bookings: b.data, packages: p.data, media: m.data, analytics: a.data, wallet: w.data, txns: t.data, reviews: r.data });
  };

  const doAction = async (bid, action) => {
    try {
      await api.post(`/bookings/${bid}/action`, { action });
      toast("Booking updated");
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  if (!user) return null;

  return (
    <div className="dash-wrap" data-testid="artist-dashboard">
      <aside className="sidebar">
        <Link to="/" className="logo mb-20" data-testid="dash-logo">
          <div className="logo-mark">B</div>
          <span style={{ fontSize: 18 }}>Book<span className="gold">Talent</span></span>
        </Link>
        <div className="sb-section">Artist Hub</div>
        {SIDEBAR.map((x) => (
          <div key={x.id} className={`sb-item ${tab === x.id ? "active" : ""}`} onClick={() => setTab(x.id)} data-testid={`sb-${x.id}`}>
            {x.label}
          </div>
        ))}
      </aside>

      <main className="dash-content">
        <Nav />
        <div style={{ marginTop: 18 }}>
          <div className="dash-head">
            <div>
              <h1>Welcome, {user.first_name} ✨</h1>
              <p>{data.bookings.filter(b => b.status === "pending_artist").length} new requests · {data.analytics.profile_views || 0} profile views</p>
            </div>
          </div>

          <div className="kpi-grid">
            <Kpi icon="💰" cls="kpi-icon-gold" num={fmtINRFull(data.analytics.earnings || 0)} label="Total Earnings" />
            <Kpi icon="📋" cls="kpi-icon-purple" num={data.analytics.total_bookings || 0} label="Total Bookings" />
            <Kpi icon="⏳" cls="kpi-icon-amber" num={data.analytics.pending_requests || 0} label="Pending Requests" />
            <Kpi icon="👁️" cls="kpi-icon-blue" num={data.analytics.profile_views || 0} label="Profile Views" />
          </div>

          {tab === "overview" && <Overview data={data} doAction={doAction} />}
          {tab === "profile" && <ProfileEditor user={user} refreshMe={refreshMe} toast={toast} />}
          {tab === "packages" && <Packages data={data} refresh={refresh} toast={toast} />}
          {tab === "media" && <MediaManager data={data} refresh={refresh} toast={toast} />}
          {tab === "calendar" && <Availability refresh={refresh} toast={toast} />}
          {tab === "bookings" && <ArtistBookings data={data} doAction={doAction} />}
          {tab === "wallet" && <Wallet data={data} refresh={refresh} toast={toast} />}
          {tab === "reviews" && <Reviews data={data} refresh={refresh} toast={toast} />}
          {tab === "boost" && <Boost refresh={refresh} toast={toast} />}
          {tab === "kyc" && <KYC toast={toast} refresh={refresh} />}
        </div>
      </main>
    </div>
  );
}

const Kpi = ({ icon, cls, num, label }) => (
  <div className="kpi" data-testid={`kpi-${label.replace(/\s+/g, "-").toLowerCase()}`}>
    <div className="kpi-top"><div className={`kpi-icon ${cls}`}>{icon}</div></div>
    <div className="kpi-num">{num}</div>
    <div className="kpi-label">{label}</div>
  </div>
);

function Overview({ data, doAction }) {
  const pending = data.bookings.filter(b => b.status === "pending_artist");
  return (
    <div data-testid="overview-tab">
      <div className="card mb-16">
        <div className="card-head"><div className="card-title">📬 Booking Requests</div></div>
        <BookingsTable bookings={pending} role="artist" onAction={doAction} />
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title">⭐ Recent Reviews</div></div>
        <div style={{ padding: 14 }}>
          {data.reviews.length === 0 ? <div className="empty"><div className="empty-icon">⭐</div><div className="empty-title">No reviews yet</div></div> :
            data.reviews.slice(0, 3).map((r) => (
              <div key={r.id} className="card card-pad mb-12">
                <div className="flex justify-between mb-8">
                  <div className="fw-600">{r.customer_name}</div>
                  <div className="text-gold">{"★".repeat(r.rating)}</div>
                </div>
                <div className="fs-13 text-muted">{r.text}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function ProfileEditor({ user, refreshMe, toast }) {
  const [form, setForm] = useState({ bio: "", tagline: "", city: "", languages: "", genres: "", event_types: "" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.get("/auth/me").then((r) => {
      const p = r.data.artist_profile || {};
      setForm({
        bio: p.bio || "", tagline: p.tagline || "", city: p.city || "",
        languages: (p.languages || []).join(", "), genres: (p.genres || []).join(", "), event_types: (p.event_types || []).join(", "),
      });
      setLoaded(true);
    });
  }, []);
  const save = async () => {
    try {
      await api.put("/users/me", {
        bio: form.bio, tagline: form.tagline, city: form.city,
        languages: form.languages.split(",").map(s => s.trim()).filter(Boolean),
        genres: form.genres.split(",").map(s => s.trim()).filter(Boolean),
        event_types: form.event_types.split(",").map(s => s.trim()).filter(Boolean),
      });
      toast("Profile saved");
      refreshMe();
    } catch (e) { toast(formatApiError(e), "error"); }
  };
  if (!loaded) return <div className="loading"><div className="spinner" /></div>;
  return (
    <div className="card card-pad" data-testid="profile-editor">
      <h2 className="font-serif fs-20 fw-700 mb-16">Artist Profile</h2>
      <div className="field">
        <div className="field-label">Tagline</div>
        <input className="field-input" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} data-testid="prof-tagline" />
      </div>
      <div className="field">
        <div className="field-label">Bio</div>
        <textarea className="field-input" rows={5} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} data-testid="prof-bio" />
      </div>
      <div className="field-row">
        <div className="field">
          <div className="field-label">City</div>
          <input className="field-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} data-testid="prof-city" />
        </div>
        <div className="field">
          <div className="field-label">Languages (comma-separated)</div>
          <input className="field-input" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} data-testid="prof-languages" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <div className="field-label">Genres</div>
          <input className="field-input" value={form.genres} onChange={(e) => setForm({ ...form, genres: e.target.value })} data-testid="prof-genres" />
        </div>
        <div className="field">
          <div className="field-label">Event Types</div>
          <input className="field-input" value={form.event_types} onChange={(e) => setForm({ ...form, event_types: e.target.value })} data-testid="prof-event-types" />
        </div>
      </div>
      <button className="btn btn-gold" onClick={save} data-testid="prof-save">Save Changes</button>
    </div>
  );
}

function Packages({ data, refresh, toast }) {
  const [modal, setModal] = useState(null);

  const save = async (pkg) => {
    try {
      if (pkg.id) await api.put(`/packages/${pkg.id}`, pkg);
      else await api.post("/packages", pkg);
      toast("Package saved");
      setModal(null);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };
  const del = async (id) => {
    if (!window.confirm("Delete this package?")) return;
    await api.delete(`/packages/${id}`);
    toast("Deleted");
    refresh();
  };

  return (
    <div data-testid="packages-tab">
      <div className="flex justify-between mb-16">
        <h2 className="font-serif fs-20 fw-700">Pricing Packages</h2>
        <button className="btn btn-gold btn-sm" onClick={() => setModal({ name: "", price: 0, duration: "", features: [], is_popular: false })} data-testid="add-package-btn">+ New Package</button>
      </div>
      <div className="grid grid-3">
        {data.packages.length === 0 && <div className="empty" style={{ gridColumn: "1/-1" }}><div className="empty-icon">📦</div><div className="empty-title">No packages yet</div></div>}
        {data.packages.map((p) => (
          <div key={p.id} className={`pkg-card ${p.is_popular ? "popular" : ""}`} data-testid={`pkg-${p.id}`}>
            <div className="pkg-name">{p.name}</div>
            <div className="text-muted fs-12 mb-12">⏱ {p.duration}</div>
            <div className="pkg-price">{fmtINRFull(p.price)}</div>
            <ul className="pkg-features">{(p.features || []).map((f, i) => <li key={i}>{f}</li>)}</ul>
            <div className="flex gap-8 mt-16">
              <button className="btn btn-ghost btn-xs" onClick={() => setModal(p)} data-testid={`edit-pkg-${p.id}`}>Edit</button>
              <button className="btn btn-red btn-xs" onClick={() => del(p.id)} data-testid={`del-pkg-${p.id}`}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {modal && <PackageModal pkg={modal} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

function PackageModal({ pkg, onSave, onClose }) {
  const [p, setP] = useState({
    ...pkg,
    features: Array.isArray(pkg.features) ? pkg.features.join("\n") : "",
  });
  return (
    <div className="modal-bg" onClick={onClose} data-testid="pkg-modal">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{pkg.id ? "Edit" : "New"} Package</div>
        <div className="field"><div className="field-label">Name</div>
          <input className="field-input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} data-testid="pkg-name" /></div>
        <div className="field-row">
          <div className="field"><div className="field-label">Price (₹)</div>
            <input className="field-input" type="number" value={p.price} onChange={(e) => setP({ ...p, price: Number(e.target.value) })} data-testid="pkg-price" /></div>
          <div className="field"><div className="field-label">Duration</div>
            <input className="field-input" value={p.duration} onChange={(e) => setP({ ...p, duration: e.target.value })} placeholder="3 hours" data-testid="pkg-duration" /></div>
        </div>
        <div className="field"><div className="field-label">Features (one per line)</div>
          <textarea className="field-input" rows={5} value={p.features} onChange={(e) => setP({ ...p, features: e.target.value })} data-testid="pkg-features" /></div>
        <label className="flex items-center gap-8 mb-16">
          <input type="checkbox" checked={p.is_popular} onChange={(e) => setP({ ...p, is_popular: e.target.checked })} data-testid="pkg-popular" />
          <span>Mark as Most Popular</span>
        </label>
        <div className="flex gap-12">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onSave({ ...p, features: p.features.split("\n").map(s => s.trim()).filter(Boolean) })} data-testid="pkg-save">Save</button>
        </div>
      </div>
    </div>
  );
}

function MediaManager({ data, refresh, toast }) {
  const inputRef = useRef();
  const [busy, setBusy] = useState(false);

  const upload = async (files, type) => {
    setBusy(true);
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) { toast("File too large (max 10MB each)", "error"); continue; }
        const dataUrl = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(f);
        });
        await api.post("/media/upload", { type, data_url: dataUrl, title: f.name });
      }
      toast("Uploaded!");
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(false);
  };

  const del = async (id) => {
    if (!window.confirm("Delete this media?")) return;
    await api.delete(`/media/${id}`);
    refresh();
  };

  return (
    <div data-testid="media-tab">
      <div className="flex justify-between mb-16">
        <h2 className="font-serif fs-20 fw-700">Media Manager</h2>
      </div>
      <div className="upload-zone mb-20" data-testid="upload-zone">
        <input ref={inputRef} type="file" multiple accept="image/*,video/*" onChange={(e) => upload(e.target.files, "gallery")} />
        <div className="upload-zone-icon">📁</div>
        <div className="fs-14 fw-600 mb-4">Drop files here or click to browse</div>
        <div className="text-muted fs-12">Images & videos up to 10MB each</div>
        {busy && <div className="spinner mt-12" style={{ margin: "12px auto 0" }} />}
      </div>
      <div className="media-grid">
        {data.media.filter((m) => m.type !== "kyc").map((m) => (
          <div key={m.id} className="media-tile" data-testid={`media-tile-${m.id}`}>
            {m.mime?.startsWith("video/") ? (
              <video src={mediaUrl(m.id)} muted />
            ) : (
              <img src={mediaUrl(m.id)} alt={m.title || ""} />
            )}
            <div className="media-tile-overlay">
              <span className="text-muted fs-11">{(m.size / 1024).toFixed(0)} KB</span>
              <button className="btn btn-red btn-xs" onClick={() => del(m.id)} data-testid={`del-media-${m.id}`}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Availability({ refresh, toast }) {
  const [dates, setDates] = useState([]);
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("blocked");
  useEffect(() => { api.get("/availability/mine").then((r) => setDates(r.data)); }, []);
  const save = async () => {
    if (!date) return;
    await api.post("/availability", { date, status });
    toast("Updated");
    api.get("/availability/mine").then((r) => setDates(r.data));
  };
  return (
    <div className="card card-pad" data-testid="availability-tab">
      <h2 className="font-serif fs-20 fw-700 mb-16">Block / Free Dates</h2>
      <div className="flex gap-12 mb-16" style={{ alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <div className="field-label">Date</div>
          <input type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} data-testid="avail-date" />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <div className="field-label">Status</div>
          <select className="field-input" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="avail-status">
            <option value="available">Available</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <button className="btn btn-gold" onClick={save} data-testid="avail-save">Save</button>
      </div>
      <h3 className="fs-13 fw-600 mb-12 text-muted">Existing Entries</h3>
      <div className="grid grid-4">
        {dates.map((d) => (
          <div key={d.id} className="card card-pad text-center" data-testid={`avail-${d.date}`}>
            <div className="fw-600">{d.date}</div>
            <div className={`pill ${d.status === "available" ? "pill-green" : d.status === "blocked" ? "pill-red" : "pill-amber"} mt-8`}>{d.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtistBookings({ data, doAction }) {
  const [filter, setFilter] = useState("all");
  const list = filter === "all" ? data.bookings : data.bookings.filter(b => {
    if (filter === "pending") return b.status === "pending_artist";
    if (filter === "confirmed") return ["confirmed", "started"].includes(b.status);
    if (filter === "completed") return ["completed", "reviewed", "completed_by_artist"].includes(b.status);
    return b.status === filter;
  });
  return (
    <div data-testid="bookings-tab">
      <div className="tab-bar mb-16">
        {["all", "pending", "confirmed", "completed"].map(f => (
          <button key={f} className={`tab-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)} data-testid={`booking-filter-${f}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div className="card">
        <BookingsTable bookings={list} role="artist" onAction={doAction} />
      </div>
    </div>
  );
}

function Wallet({ data, refresh, toast }) {
  const [amt, setAmt] = useState("");
  const withdraw = async () => {
    if (!amt || Number(amt) <= 0) return;
    try {
      await api.post("/wallet/withdraw", { amount: Number(amt) });
      toast("Withdrawal requested");
      setAmt("");
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };
  return (
    <div data-testid="wallet-tab">
      <div className="card card-pad mb-16" style={{ background: "linear-gradient(135deg, rgba(212,175,55,0.1), rgba(109,40,217,0.05))" }}>
        <div className="text-muted fs-12 mb-8">Available Balance</div>
        <div className="font-serif" style={{ fontSize: 48, fontWeight: 700, color: "var(--gold-light)" }} data-testid="wallet-balance">
          {fmtINRFull(data.wallet?.balance || 0)}
        </div>
        <div className="grid grid-4 mt-20">
          <div><div className="text-muted fs-11">Pending</div><div className="fw-700 fs-16">{fmtINRFull(data.wallet?.pending || 0)}</div></div>
          <div><div className="text-muted fs-11">Total Earned</div><div className="fw-700 fs-16">{fmtINRFull(data.wallet?.total_earned || 0)}</div></div>
          <div><div className="text-muted fs-11">Withdrawn</div><div className="fw-700 fs-16">{fmtINRFull(data.wallet?.total_withdrawn || 0)}</div></div>
        </div>
        <div className="flex gap-12 mt-20" style={{ alignItems: "end" }}>
          <div className="field" style={{ marginBottom: 0, flex: 1 }}>
            <div className="field-label">Withdraw Amount</div>
            <input type="number" className="field-input" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Enter amount" data-testid="withdraw-amount" />
          </div>
          <button className="btn btn-gold" onClick={withdraw} data-testid="withdraw-btn">💸 Withdraw</button>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div className="card-title">📜 Transaction History</div></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Description</th><th>Date</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {data.txns.length === 0 && <tr><td colSpan={5} className="empty">No transactions</td></tr>}
              {data.txns.map((t) => (
                <tr key={t.id} data-testid={`txn-${t.id}`}>
                  <td>{t.description}</td>
                  <td className="fs-12 text-muted">{t.created_at?.slice(0, 10)}</td>
                  <td><span className="pill pill-purple">{t.type}</span></td>
                  <td className={t.amount > 0 ? "text-green fw-700" : "text-red fw-700"}>{fmtINRFull(Math.abs(t.amount))}</td>
                  <td><span className={`status-pill ${t.status === "completed" ? "sp-confirmed" : "sp-pending"}`}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Reviews({ data, refresh, toast }) {
  const [reply, setReply] = useState({});
  const sendReply = async (rid) => {
    try {
      await api.post(`/reviews/${rid}/reply`, { reply: reply[rid] });
      toast("Reply sent");
      setReply({});
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };
  return (
    <div className="card card-pad" data-testid="reviews-tab">
      <h2 className="font-serif fs-20 fw-700 mb-16">Client Reviews</h2>
      {data.reviews.length === 0 && <div className="empty"><div className="empty-icon">⭐</div><div className="empty-title">No reviews yet</div></div>}
      {data.reviews.map((r) => (
        <div key={r.id} className="card card-pad mb-12" data-testid={`review-${r.id}`}>
          <div className="flex justify-between mb-8">
            <div>
              <div className="fw-600">{r.customer_name}</div>
              <div className="text-muted fs-11">{r.event_type} · {r.created_at?.slice(0, 10)}</div>
            </div>
            <div className="text-gold">{"★".repeat(r.rating)}</div>
          </div>
          <div className="fs-13 mb-12">{r.text}</div>
          {r.reply ? (
            <div style={{ padding: 12, background: "rgba(109,40,217,0.08)", borderRadius: 10 }}>
              <div className="text-muted fs-11 mb-4">Your reply:</div>
              <div className="fs-13">{r.reply}</div>
            </div>
          ) : (
            <div className="flex gap-8">
              <input className="field-input" placeholder="Reply to this review…" value={reply[r.id] || ""} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} data-testid={`reply-${r.id}`} />
              <button className="btn btn-gold btn-sm" onClick={() => sendReply(r.id)} disabled={!reply[r.id]}>Reply</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Boost({ refresh, toast }) {
  const [busy, setBusy] = useState(false);
  const activate = async (plan) => {
    setBusy(true);
    try {
      await api.post("/boost/activate", { plan });
      toast(`Boost ${plan} activated!`);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(false);
  };
  return (
    <div data-testid="boost-tab">
      <h2 className="font-serif fs-20 fw-700 mb-16">Boost Your Profile</h2>
      <div className="grid grid-3">
        {[
          { id: "starter", name: "Starter Boost", price: 999, days: 7, feats: ["2x visibility", "Category highlight", "Search priority"] },
          { id: "pro", name: "Pro Boost", price: 2499, days: 30, popular: true, feats: ["5x visibility", "Homepage feature", "Top search", "Social promo"] },
          { id: "elite", name: "Elite Campaign", price: 7499, days: 90, feats: ["10x visibility", "Dedicated campaign", "Email newsletter", "Account manager"] },
        ].map((p) => (
          <div key={p.id} className={`pkg-card ${p.popular ? "popular" : ""}`} data-testid={`boost-${p.id}`}>
            {p.popular && <span className="popular-tag">RECOMMENDED</span>}
            <div className="pkg-name">{p.name}</div>
            <div className="pkg-price">{fmtINRFull(p.price)}</div>
            <div className="text-muted fs-12 mb-12">For {p.days} days</div>
            <ul className="pkg-features">{p.feats.map((f, i) => <li key={i}>{f}</li>)}</ul>
            <button className="btn btn-gold btn-block mt-16" onClick={() => activate(p.id)} disabled={busy} data-testid={`activate-${p.id}`}>Activate</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function KYC({ toast, refresh }) {
  const [aadhaar, setAadhaar] = useState("");
  const [pan, setPan] = useState("");
  const [kyc, setKyc] = useState(null);
  useEffect(() => { api.get("/kyc/mine").then((r) => setKyc(r.data)); }, []);
  const upload = async (file, setter) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setter(r.result);
    r.readAsDataURL(file);
  };
  const submit = async () => {
    try {
      await api.post("/kyc/submit", { aadhaar, pan });
      toast("KYC submitted for review");
      api.get("/kyc/mine").then((r) => setKyc(r.data));
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };
  return (
    <div className="card card-pad" data-testid="kyc-tab">
      <h2 className="font-serif fs-20 fw-700 mb-8">KYC Documents</h2>
      <p className="text-muted fs-13 mb-20">Verify your identity to unlock payouts and premium features.</p>
      {kyc && <div className={`pill mb-16 ${kyc.status === "approved" ? "pill-green" : kyc.status === "rejected" ? "pill-red" : "pill-amber"}`}>Status: {kyc.status}</div>}
      <div className="field">
        <div className="field-label">Aadhaar Card</div>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files[0], setAadhaar)} data-testid="kyc-aadhaar" />
        {aadhaar && <div className="pill pill-green mt-8">✓ File selected</div>}
      </div>
      <div className="field">
        <div className="field-label">PAN Card</div>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files[0], setPan)} data-testid="kyc-pan" />
        {pan && <div className="pill pill-green mt-8">✓ File selected</div>}
      </div>
      <button className="btn btn-gold" disabled={!aadhaar && !pan} onClick={submit} data-testid="kyc-submit">Submit for Review</button>
    </div>
  );
}
