import React, { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError, mediaUrl } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { BookingsTable } from "./CustomerDashboard";
import OnboardingWizard from "../components/OnboardingWizard";

/**
 * Media thumbnail with a graceful React-state fallback when the thumb URL 404s
 * or the image decode fails. Replaces the earlier `insertAdjacentHTML` hack
 * flagged by the code review — no DOM mutation, no XSS surface.
 */
function MediaThumb({ id, title }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 48 }}>📎</div>
    );
  }
  return (
    <img
      src={`${api.defaults.baseURL}/media/${id}/thumb`}
      alt={title}
      onError={() => setBroken(true)}
    />
  );
}

const SIDEBAR = [
  { id: "overview", label: "📊 Overview" },
  { id: "profile", label: "👤 Profile" },
  { id: "packages", label: "📦 Packages" },
  { id: "addons", label: "🎁 Add-ons" },
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
  const [showWizard, setShowWizard] = useState(false);
  const [counterModal, setCounterModal] = useState(null);

  // Auto-show wizard if onboarding required (test-unblocking scaffold)
  useEffect(() => {
    if (!user || user.role !== "artist") return;
    api.get("/onboarding/me").then((r) => {
      if (r.data?.required && !r.data?.completed) setShowWizard(true);
    }).catch(() => {});
  }, [user]);

  const submitCounter = async (price) => {
    if (!counterModal) return;
    try {
      await api.post(`/bookings/${counterModal.id}/action`, { action: "counter", counter_price: Number(price) });
      toast("Counter offer sent");
      setCounterModal(null);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  useEffect(() => {
    if (!user) { nav("/login"); return; }
    if (user.role !== "artist") { nav(user.role === "admin" ? "/admin" : "/customer"); return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (action === "counter") {
      const b = data.bookings.find((x) => x.id === bid);
      if (b) setCounterModal(b);
      return;
    }
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
          {tab === "addons" && <Addons toast={toast} />}
          {tab === "media" && <MediaManager data={data} refresh={refresh} toast={toast} />}
          {tab === "calendar" && <Availability refresh={refresh} toast={toast} />}
          {tab === "bookings" && <ArtistBookings data={data} doAction={doAction} />}
          {tab === "wallet" && <Wallet data={data} refresh={refresh} toast={toast} />}
          {tab === "reviews" && <Reviews data={data} refresh={refresh} toast={toast} />}
          {tab === "boost" && <Boost refresh={refresh} toast={toast} />}
          {tab === "kyc" && <KYC toast={toast} refresh={refresh} />}
        </div>
      </main>
      {showWizard && <OnboardingWizard user={user} onComplete={() => { setShowWizard(false); refresh(); refreshMe(); }} />}
      {counterModal && <CounterModal booking={counterModal} onSubmit={submitCounter} onClose={() => setCounterModal(null)} />}
    </div>
  );
}

function CounterModal({ booking, onSubmit, onClose }) {
  const [price, setPrice] = useState(booking?.pricing?.package_fee || "");
  return (
    <div className="modal-bg" onClick={onClose} data-testid="counter-modal">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Counter Offer</div>
        <div className="modal-sub">{booking.event_type} · {booking.event_date}</div>
        <div className="card card-pad mb-16">
          <div className="text-muted fs-12">Customer offered (package fee)</div>
          <div className="font-serif fs-18 fw-700">{fmtINRFull(booking?.pricing?.package_fee || 0)}</div>
        </div>
        <div className="field">
          <div className="field-label">Your Counter Price (₹)</div>
          <input type="number" className="field-input" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="counter-price-input" />
          <div className="field-hint">Customer will be notified to accept or decline.</div>
        </div>
        <div className="flex gap-12">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onSubmit(booking.id, price)} disabled={!price} data-testid="counter-submit">
            Send Counter Offer
          </button>
        </div>
      </div>
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
  const [form, setForm] = useState({
    bio: "", tagline: "", city: "", languages: "", genres: "", event_types: "",
    awards: "", certifications: "", youtube_url: "", instagram_url: "", spotify_url: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState({});
  const [uploading, setUploading] = useState({ profile: false, cover: false });
  const [progress, setProgress] = useState({ profile: 0, cover: 0 });
  const profileRef = useRef();
  const coverRef = useRef();
  const [cacheBust, setCacheBust] = useState(Date.now());

  const reload = async () => {
    const r = await api.get("/auth/me");
    const p = r.data.artist_profile || {};
    setProfile(p);
    setForm({
      bio: p.bio || "", tagline: p.tagline || "", city: p.city || "",
      languages: (p.languages || []).join(", "),
      genres: (p.genres || []).join(", "),
      event_types: (p.event_types || []).join(", "),
      awards: (p.awards || []).join("\n"),
      certifications: (p.certifications || []).join("\n"),
      youtube_url: p.youtube_url || "",
      instagram_url: p.instagram_url || "",
      spotify_url: p.spotify_url || "",
    });
    setCacheBust(Date.now());
    setLoaded(true);
  };

  useEffect(() => { reload(); }, []);

  const uploadImage = async (file, type) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Please pick an image", "error"); return; }
    if (file.size > 12 * 1024 * 1024) { toast("Image too large (max 12 MB)", "error"); return; }
    setUploading((u) => ({ ...u, [type]: true }));
    setProgress((p) => ({ ...p, [type]: 0 }));
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = rej;
        r.readAsDataURL(file);
      });
      // Delete previous image of this type to avoid orphans
      const existing = profile[type === "profile" ? "profile_image" : "cover_image"];
      if (existing) {
        try {
          await api.delete(`/media/${existing}`);
        } catch (delErr) {
          // Non-fatal — orphaned media will be cleaned up by the nightly job.
          // Log so we can spot patterns instead of silently swallowing.
          if (typeof console !== "undefined") console.warn("orphan-media delete failed:", delErr?.message || delErr);
        }
      }
      await api.post("/media/upload", { type, data_url: dataUrl, title: `${type}-${file.name}` }, {
        onUploadProgress: (e) => {
          if (e.total) setProgress((p) => ({ ...p, [type]: Math.round((e.loaded / e.total) * 100) }));
        },
      });
      toast(`${type === "profile" ? "Profile picture" : "Cover banner"} updated`);
      await reload();
      refreshMe();
    } catch (e) { toast(formatApiError(e), "error"); }
    setUploading((u) => ({ ...u, [type]: false }));
    setProgress((p) => ({ ...p, [type]: 0 }));
    // reset the input so the same file can be reselected
    if (type === "profile" && profileRef.current) profileRef.current.value = "";
    if (type === "cover" && coverRef.current) coverRef.current.value = "";
  };

  const save = async () => {
    try {
      await api.put("/users/me", {
        bio: form.bio, tagline: form.tagline, city: form.city,
        languages: form.languages.split(",").map(s => s.trim()).filter(Boolean),
        genres: form.genres.split(",").map(s => s.trim()).filter(Boolean),
        event_types: form.event_types.split(",").map(s => s.trim()).filter(Boolean),
        awards: form.awards.split("\n").map(s => s.trim()).filter(Boolean),
        certifications: form.certifications.split("\n").map(s => s.trim()).filter(Boolean),
        youtube_url: form.youtube_url,
        instagram_url: form.instagram_url,
        spotify_url: form.spotify_url,
      });
      toast("Profile saved");
      refreshMe();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  if (!loaded) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div className="card card-pad" data-testid="profile-editor">
      <h2 className="font-serif fs-20 fw-700 mb-16">Artist Profile</h2>

      {/* Cover Banner */}
      <div className="field">
        <div className="field-label">Cover Banner</div>
        <div
          onClick={() => coverRef.current?.click()}
          style={{
            height: 160, borderRadius: 12, cursor: "pointer", position: "relative",
            border: "2px dashed var(--glass-border)",
            background: profile.cover_image
              ? `linear-gradient(180deg, rgba(0,0,0,0.2), rgba(0,0,0,0.5)), url(${mediaUrl(profile.cover_image)}?v=${cacheBust}) center/cover`
              : "linear-gradient(135deg, var(--bg3), var(--purple))",
            display: "grid", placeItems: "center",
          }}
          data-testid="cover-upload-zone"
        >
          <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }}
                 onChange={(e) => uploadImage(e.target.files[0], "cover")} />
          {uploading.cover ? (
            <div className="text-center">
              <div className="spinner" style={{ margin: "0 auto 8px" }} />
              <div className="fs-12 fw-600">Uploading… {progress.cover}%</div>
            </div>
          ) : (
            <div className="text-center">
              <div className="fs-22 mb-4">🖼️</div>
              <div className="fs-13 fw-600">{profile.cover_image ? "Click to replace" : "Click to upload cover banner"}</div>
              <div className="fs-11 text-muted mt-4">Recommended 1600 × 480 · Max 12 MB</div>
            </div>
          )}
        </div>
      </div>

      {/* Profile Picture */}
      <div className="field">
        <div className="field-label">Profile Picture</div>
        <div className="flex items-center gap-16">
          <div
            onClick={() => profileRef.current?.click()}
            className="avatar avatar-lg"
            style={{
              cursor: "pointer", position: "relative",
              width: 96, height: 96,
              background: profile.profile_image
                ? `url(${mediaUrl(profile.profile_image)}?v=${cacheBust}) center/cover`
                : "linear-gradient(135deg, var(--purple), var(--gold))",
              fontSize: profile.profile_image ? 0 : 36,
              border: "2px solid var(--gold-border)",
            }}
            data-testid="profile-upload-zone"
          >
            <input ref={profileRef} type="file" accept="image/*" style={{ display: "none" }}
                   onChange={(e) => uploadImage(e.target.files[0], "profile")} />
            {!profile.profile_image && (profile.emoji || "🎤")}
            {uploading.profile && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", borderRadius: "50%" }}>
                <div className="fs-11 fw-700 text-gold">{progress.profile}%</div>
              </div>
            )}
          </div>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => profileRef.current?.click()} disabled={uploading.profile} data-testid="pick-profile-btn">
              {uploading.profile ? "Uploading…" : profile.profile_image ? "Change Photo" : "Upload Photo"}
            </button>
            <div className="text-muted fs-11 mt-4">Square format · Max 12 MB</div>
          </div>
        </div>
      </div>

      <div className="divider" />

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
      <div className="field">
        <div className="field-label">Awards (one per line)</div>
        <textarea className="field-input" rows={3} value={form.awards} onChange={(e) => setForm({ ...form, awards: e.target.value })} placeholder="MTV India Music Award 2023" data-testid="prof-awards" />
      </div>
      <div className="field">
        <div className="field-label">Certifications (one per line)</div>
        <textarea className="field-input" rows={3} value={form.certifications} onChange={(e) => setForm({ ...form, certifications: e.target.value })} placeholder="Trinity College London - Grade 8 Vocals" data-testid="prof-certifications" />
      </div>
      <h3 className="fs-13 fw-600 mb-12 mt-16 text-muted" style={{ textTransform: "uppercase", letterSpacing: 1 }}>Social Links</h3>
      <div className="field-row">
        <div className="field">
          <div className="field-label">YouTube</div>
          <input className="field-input" value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })} placeholder="https://youtube.com/@you" data-testid="prof-youtube" />
        </div>
        <div className="field">
          <div className="field-label">Instagram</div>
          <input className="field-input" value={form.instagram_url} onChange={(e) => setForm({ ...form, instagram_url: e.target.value })} placeholder="https://instagram.com/you" data-testid="prof-instagram" />
        </div>
      </div>
      <div className="field">
        <div className="field-label">Spotify (optional)</div>
        <input className="field-input" value={form.spotify_url} onChange={(e) => setForm({ ...form, spotify_url: e.target.value })} placeholder="https://spotify.com/artist/..." data-testid="prof-spotify" />
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
    travel_required: false,
    accommodation_required: false,
    hotel_category: "",
    flight_class: "",
    team_size: "",
    arrival_buffer_days: "",
    local_transport_required: false,
    meals_required: false,
    travel_notes: "",
    ...pkg,
    features: Array.isArray(pkg.features) ? pkg.features.join("\n") : "",
  });
  return (
    <div className="modal-bg" onClick={onClose} data-testid="pkg-modal">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
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

        {/* Sprint 4 — Travel & Accommodation Requirements */}
        <div className="divider" style={{ margin: "16px 0" }} />
        <div className="fw-700 fs-13 mb-8 text-gold" style={{ textTransform: "uppercase", letterSpacing: 1 }}>✈️ Travel & Accommodation Rider</div>
        <div className="text-muted fs-11 mb-12">These requirements are borne by the customer directly (not billed by BookTalent). They will be included in the booking agreement.</div>

        <div className="field-row">
          <label className="flex items-center gap-8">
            <input type="checkbox" checked={!!p.travel_required} onChange={(e) => setP({ ...p, travel_required: e.target.checked })} data-testid="pkg-travel-required" />
            <span>Travel required</span>
          </label>
          <label className="flex items-center gap-8">
            <input type="checkbox" checked={!!p.accommodation_required} onChange={(e) => setP({ ...p, accommodation_required: e.target.checked })} data-testid="pkg-accommodation-required" />
            <span>Accommodation required</span>
          </label>
        </div>

        {(p.travel_required || p.accommodation_required) && (
          <>
            <div className="field-row">
              <div className="field">
                <div className="field-label">Flight class</div>
                <select className="field-input" value={p.flight_class || ""} onChange={(e) => setP({ ...p, flight_class: e.target.value })} data-testid="pkg-flight-class">
                  <option value="">—</option>
                  <option value="economy">Economy</option>
                  <option value="premium-economy">Premium Economy</option>
                  <option value="business">Business</option>
                  <option value="first">First</option>
                </select>
              </div>
              <div className="field">
                <div className="field-label">Hotel category</div>
                <select className="field-input" value={p.hotel_category || ""} onChange={(e) => setP({ ...p, hotel_category: e.target.value })} data-testid="pkg-hotel-category">
                  <option value="">—</option>
                  <option value="3-star">3-Star</option>
                  <option value="4-star">4-Star</option>
                  <option value="5-star">5-Star</option>
                  <option value="luxury">Luxury / Boutique</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <div className="field-label">Team size (people)</div>
                <input className="field-input" type="number" min="1" value={p.team_size || ""} onChange={(e) => setP({ ...p, team_size: Number(e.target.value) || "" })} data-testid="pkg-team-size" />
              </div>
              <div className="field">
                <div className="field-label">Arrival buffer (days before event)</div>
                <input className="field-input" type="number" min="0" value={p.arrival_buffer_days || ""} onChange={(e) => setP({ ...p, arrival_buffer_days: Number(e.target.value) || "" })} data-testid="pkg-arrival-buffer" />
              </div>
            </div>
          </>
        )}

        <div className="field-row">
          <label className="flex items-center gap-8">
            <input type="checkbox" checked={!!p.local_transport_required} onChange={(e) => setP({ ...p, local_transport_required: e.target.checked })} data-testid="pkg-local-transport" />
            <span>Local transport required</span>
          </label>
          <label className="flex items-center gap-8">
            <input type="checkbox" checked={!!p.meals_required} onChange={(e) => setP({ ...p, meals_required: e.target.checked })} data-testid="pkg-meals" />
            <span>Meals during stay</span>
          </label>
        </div>

        <div className="field">
          <div className="field-label">Additional rider notes</div>
          <textarea className="field-input" rows={3} value={p.travel_notes || ""} onChange={(e) => setP({ ...p, travel_notes: e.target.value })} placeholder="e.g. vegetarian meals, specific hotel brand preference, green room requirements…" data-testid="pkg-travel-notes" />
        </div>

        <div className="flex gap-12">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => onSave({
            ...p,
            features: p.features.split("\n").map(s => s.trim()).filter(Boolean),
            team_size: p.team_size ? Number(p.team_size) : null,
            arrival_buffer_days: p.arrival_buffer_days !== "" ? Number(p.arrival_buffer_days) : null,
          })} data-testid="pkg-save">Save</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sprint 3 — Artist-defined Add-ons management (CRUD + toggle active)
// ────────────────────────────────────────────────────────────────────────
function Addons({ toast }) {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const r = await api.get("/artist/addons");
      setItems(r.data);
    } catch (e) { toast(formatApiError(e), "error"); }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line

  const save = async (a) => {
    try {
      if (a.id) {
        const { id, artist_id, created_at, updated_at, deleted, ...patch } = a;
        await api.patch(`/artist/addons/${id}`, patch);
      } else {
        await api.post("/artist/addons", a);
      }
      toast("Add-on saved");
      setModal(null);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  const toggleActive = async (a) => {
    try {
      await api.patch(`/artist/addons/${a.id}`, { active: !a.active });
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this add-on? Historical bookings will keep their snapshot.")) return;
    try {
      await api.delete(`/artist/addons/${id}`);
      toast("Add-on deleted");
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  return (
    <div data-testid="addons-tab">
      <div className="flex justify-between mb-16">
        <div>
          <h2 className="font-serif fs-20 fw-700">Booking Add-ons</h2>
          <p className="text-muted fs-13">Extras customers can pick when they book you (extra hour, sound system, extra performer, etc.).</p>
        </div>
        <button className="btn btn-gold btn-sm" onClick={() => setModal({ name: "", description: "", price: 0, is_mandatory: false, max_quantity: 1, gst_pct: 0, active: true })} data-testid="add-addon-btn">+ New Add-on</button>
      </div>
      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty"><div className="empty-icon">🎁</div><div className="empty-title">No add-ons yet</div><p className="fs-13 text-muted">Add extras to boost your booking value.</p></div>
      ) : (
        <div className="grid grid-3">
          {items.map((a) => (
            <div key={a.id} className={`pkg-card ${a.is_mandatory ? "popular" : ""}`} data-testid={`addon-item-${a.id}`}>
              {a.is_mandatory && <span className="popular-tag">★ Mandatory</span>}
              <div className="pkg-name" style={{ marginTop: a.is_mandatory ? 12 : 0 }}>{a.name}</div>
              {a.description && <div className="text-muted fs-12 mb-8">{a.description}</div>}
              <div className="pkg-price">{fmtINRFull(a.price)}</div>
              <div className="text-muted fs-11">Up to {a.max_quantity} · {a.gst_pct}% GST</div>
              <div className="flex gap-8 mt-16 items-center">
                <label className="flex items-center gap-8 fs-12" style={{ marginRight: "auto" }}>
                  <input type="checkbox" checked={!!a.active} onChange={() => toggleActive(a)} data-testid={`addon-toggle-${a.id}`} />
                  <span>{a.active ? "Active" : "Inactive"}</span>
                </label>
                <button className="btn btn-ghost btn-xs" onClick={() => setModal(a)} data-testid={`edit-addon-${a.id}`}>Edit</button>
                <button className="btn btn-red btn-xs" onClick={() => del(a.id)} data-testid={`del-addon-${a.id}`}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && <AddonModal item={modal} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

function AddonModal({ item, onSave, onClose }) {
  const [a, setA] = useState(item);
  return (
    <div className="modal-bg" onClick={onClose} data-testid="addon-modal">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-title">{item.id ? "Edit" : "New"} Add-on</div>
        <div className="field"><div className="field-label">Name *</div>
          <input className="field-input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="e.g. Extra Hour of Performance" data-testid="addon-name" /></div>
        <div className="field"><div className="field-label">Description</div>
          <textarea className="field-input" rows={2} value={a.description || ""} onChange={(e) => setA({ ...a, description: e.target.value })} placeholder="Short pitch for the customer" data-testid="addon-desc" /></div>
        <div className="field-row">
          <div className="field"><div className="field-label">Price (₹) *</div>
            <input className="field-input" type="number" min="0" value={a.price} onChange={(e) => setA({ ...a, price: Number(e.target.value) })} data-testid="addon-price" /></div>
          <div className="field"><div className="field-label">Max Quantity</div>
            <input className="field-input" type="number" min="1" max="100" value={a.max_quantity} onChange={(e) => setA({ ...a, max_quantity: Number(e.target.value) })} data-testid="addon-maxq" /></div>
        </div>
        <div className="field-row">
          <div className="field"><div className="field-label">GST % (on add-on)</div>
            <input className="field-input" type="number" min="0" max="28" value={a.gst_pct} onChange={(e) => setA({ ...a, gst_pct: Number(e.target.value) })} data-testid="addon-gst" /></div>
          <div className="field" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 8 }}>
            <label className="flex items-center gap-8">
              <input type="checkbox" checked={!!a.is_mandatory} onChange={(e) => setA({ ...a, is_mandatory: e.target.checked })} data-testid="addon-mandatory" />
              <span>Mandatory (customer must select)</span>
            </label>
          </div>
        </div>
        <label className="flex items-center gap-8 mb-16">
          <input type="checkbox" checked={!!a.active} onChange={(e) => setA({ ...a, active: e.target.checked })} data-testid="addon-active" />
          <span>Active (visible to customers)</span>
        </label>
        <div className="flex gap-12">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" style={{ flex: 1 }} disabled={!a.name || a.price < 0} onClick={() => onSave(a)} data-testid="addon-save">Save Add-on</button>
        </div>
      </div>
    </div>
  );
}

function MediaManager({ data, refresh, toast }) {
  const inputRef = useRef();
  const replaceRefs = useRef({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const fileToDataUrl = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsDataURL(f);
  });

  const upload = async (files, type) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setProgress(0);
    const list = Array.from(files);
    try {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f.size > 12 * 1024 * 1024) { toast(`${f.name} too large (max 12MB)`, "error"); continue; }
        const dataUrl = await fileToDataUrl(f);
        await api.post("/media/upload", { type, data_url: dataUrl, title: f.name }, {
          onUploadProgress: (e) => {
            const fileProg = e.total ? (e.loaded / e.total) : 0;
            setProgress(Math.round(((i + fileProg) / list.length) * 100));
          },
        });
      }
      toast(`Uploaded ${list.length} file${list.length > 1 ? "s" : ""}`);
      await refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  const replace = async (mediaId, file) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { toast("File too large (max 12MB)", "error"); return; }
    try {
      const dataUrl = await fileToDataUrl(file);
      await api.put(`/media/${mediaId}`, { type: "gallery", data_url: dataUrl, title: file.name });
      toast("Replaced");
      await refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
    if (replaceRefs.current[mediaId]) replaceRefs.current[mediaId].value = "";
  };

  const del = async (id) => {
    if (!window.confirm("Delete this media?")) return;
    await api.delete(`/media/${id}`);
    await refresh();
    toast("Deleted");
  };

  const toggleFeatured = async (id) => {
    await api.post(`/media/${id}/feature`);
    await refresh();
  };

  const move = async (idx, dir) => {
    const items = data.media.filter((m) => !["kyc", "profile", "cover"].includes(m.type));
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const swap = [...items];
    [swap[idx], swap[j]] = [swap[j], swap[idx]];
    await api.post("/media/reorder", { ids: swap.map(x => x.id) });
    await refresh();
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files) upload(e.dataTransfer.files, "gallery");
  };

  const galleryItems = data.media.filter((m) => !["kyc", "profile", "cover"].includes(m.type));

  return (
    <div data-testid="media-tab">
      <div className="flex justify-between mb-16">
        <h2 className="font-serif fs-20 fw-700">Media Manager</h2>
        <div className="text-muted fs-12">{galleryItems.length} item{galleryItems.length !== 1 ? "s" : ""}</div>
      </div>
      <div
        className="upload-zone mb-20"
        data-testid="upload-zone"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef} type="file" multiple
          accept="image/*,video/*,audio/*,application/pdf"
          onChange={(e) => upload(e.target.files, "gallery")}
          style={{ display: "none" }}
        />
        <div className="upload-zone-icon">📁</div>
        <div className="fs-14 fw-600 mb-4">{busy ? `Uploading… ${progress}%` : "Drop files here or click to browse"}</div>
        <div className="text-muted fs-12">Auto-compressed & thumbnailed · Up to 12 MB each</div>
        {busy && (
          <div style={{ width: "60%", margin: "12px auto 0", height: 6, background: "var(--glass)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg, var(--gold), var(--purple))", transition: "width 0.2s" }} />
          </div>
        )}
      </div>
      <div className="media-grid">
        {galleryItems.map((m, idx) => (
          <div key={m.id} className="media-tile" data-testid={`media-tile-${m.id}`}>
            {m.mime?.startsWith("video/") ? (
              <video src={mediaUrl(m.id)} muted />
            ) : m.mime?.startsWith("audio/") ? (
              <div style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 48 }}>🎵</div>
            ) : m.mime === "application/pdf" ? (
              <div style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 48 }}>📄</div>
            ) : m.mime?.startsWith("image/") ? (
              <MediaThumb id={m.id} title={m.title || ""} />
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 48 }}>📎</div>
            )}
            {m.is_featured && (
              <div style={{ position: "absolute", top: 6, left: 6, padding: "2px 7px", background: "var(--gold)", color: "#000", fontSize: 10, fontWeight: 700, borderRadius: 5 }}>★ FEATURED</div>
            )}
            <div className="media-tile-overlay" style={{ opacity: 1, background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 60%)", padding: 6, flexDirection: "column", gap: 4 }}>
              <div className="flex gap-4" style={{ width: "100%", justifyContent: "space-between" }}>
                <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); move(idx, -1); }} title="Move left" data-testid={`move-left-${m.id}`} disabled={idx === 0}>←</button>
                <button className="btn btn-ghost btn-xs" onClick={(e) => { e.stopPropagation(); move(idx, 1); }} title="Move right" data-testid={`move-right-${m.id}`} disabled={idx === galleryItems.length - 1}>→</button>
              </div>
              <div className="flex gap-4" style={{ width: "100%" }}>
                <button
                  className={`btn btn-xs ${m.is_featured ? "btn-gold" : "btn-ghost"}`}
                  onClick={(e) => { e.stopPropagation(); toggleFeatured(m.id); }}
                  data-testid={`feature-${m.id}`}
                  title={m.is_featured ? "Unfeature" : "Set as featured"}
                  style={{ flex: 1 }}
                >★</button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={(e) => { e.stopPropagation(); replaceRefs.current[m.id]?.click(); }}
                  data-testid={`replace-${m.id}`}
                  title="Replace"
                  style={{ flex: 1 }}
                >↻</button>
                <input
                  ref={(el) => { if (el) replaceRefs.current[m.id] = el; }}
                  type="file" accept="image/*,video/*,audio/*,application/pdf"
                  style={{ display: "none" }}
                  onChange={(e) => replace(m.id, e.target.files[0])}
                />
                <button className="btn btn-red btn-xs" onClick={(e) => { e.stopPropagation(); del(m.id); }} data-testid={`del-media-${m.id}`} title="Delete" style={{ flex: 1 }}>✕</button>
              </div>
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
  const [packages, setPackages] = useState([]);
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState("all");

  const load = async () => {
    const [p, m] = await Promise.all([api.get("/boost/packages"), api.get("/boost/mine")]);
    setPackages(p.data);
    setMine(m.data);
  };
  useEffect(() => { load(); }, []);

  const purchase = async (pkg) => {
    if (!window.confirm(`Purchase ${pkg.name} for ₹${pkg.price}? (Mock payment in test mode)`)) return;
    setBusy(pkg.id);
    try {
      await api.post("/boost/purchase", { package_id: pkg.id, payment_method: "mock" });
      toast(`✓ Activated: ${pkg.name}`);
      await load();
      refresh && refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(null);
  };

  const TYPE_LABELS = {
    featured_artist: "⭐ Featured Artist",
    homepage_banner: "🏆 Homepage Banner",
    category_top: "👑 Category Top",
    search_priority: "🚀 Search Priority",
    premium_badge: "💎 Premium Badge",
    verified_badge: "✓ Verified Badge",
    city_featured: "🏙️ City Featured",
    trending: "🔥 Trending",
    recommended: "👍 Recommended",
  };

  const types = ["all", ...Object.keys(TYPE_LABELS)];
  const filtered = filter === "all" ? packages : packages.filter((p) => p.type === filter);
  const activeSubs = mine.filter((s) => s.status === "active");

  return (
    <div data-testid="boost-tab">
      <div className="flex items-center" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 className="font-serif fs-20 fw-700">Boost Your Profile</h2>
          <p className="text-muted fs-13">Premium promotion packages — pay once, get visibility for days.</p>
        </div>
        {activeSubs.length > 0 && (
          <div className="pill pill-gold" data-testid="active-boost-count">{activeSubs.length} Active Boost{activeSubs.length > 1 ? "s" : ""}</div>
        )}
      </div>

      {activeSubs.length > 0 && (
        <div className="card card-pad mb-16" data-testid="active-boosts">
          <div className="fw-700 mb-8">Your Active Boosts</div>
          <div className="grid grid-3 gap-12">
            {activeSubs.map((s) => (
              <div key={s.id} className="card card-pad" style={{ background: "var(--glass)" }}>
                <div className="text-gold fw-700">{TYPE_LABELS[s.type] || s.type}</div>
                <div className="fs-12">{s.package_snapshot?.name}</div>
                <div className="text-muted fs-11 mt-4">Expires {s.expires_at?.slice(0, 10)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-8 mb-16" style={{ flexWrap: "wrap", marginBottom: 16 }}>
        {types.map((t) => (
          <button key={t} className={`btn btn-xs ${filter === t ? "btn-gold" : "btn-ghost"}`} onClick={() => setFilter(t)} data-testid={`boost-filter-${t}`}>
            {t === "all" ? "All" : TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-3 gap-16">
        {filtered.length === 0 && <div className="text-muted">No packages available.</div>}
        {filtered.map((p) => {
          const total = (p.price + p.price * p.gst_pct / 100).toFixed(0);
          return (
            <div key={p.id} className="pkg-card" data-testid={`pkg-${p.id}`}>
              <div className="text-muted fs-11 mb-4" style={{ marginBottom: 4 }}>{TYPE_LABELS[p.type] || p.type}</div>
              <div className="pkg-name">{p.name}</div>
              <div className="pkg-price">{fmtINRFull(p.price)}</div>
              <div className="text-muted fs-12 mb-12">+ {p.gst_pct}% GST = {fmtINRFull(total)}</div>
              <div className="fs-12 mb-8" style={{ marginBottom: 8 }}>⏱️ {p.duration_days} days</div>
              {p.description && <div className="text-muted fs-12 mb-12">{p.description}</div>}
              <button className="btn btn-gold btn-block mt-16" onClick={() => purchase(p)} disabled={busy === p.id} data-testid={`purchase-${p.id}`}>
                {busy === p.id ? "Activating..." : "Activate"}
              </button>
            </div>
          );
        })}
      </div>

      {mine.length > activeSubs.length && (
        <div className="card card-pad mt-24" style={{ marginTop: 24 }}>
          <div className="fw-700 mb-12">Past Subscriptions</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Package</th><th>Started</th><th>Expired</th><th>Status</th></tr></thead>
              <tbody>
                {mine.filter((s) => s.status !== "active").map((s) => (
                  <tr key={s.id}>
                    <td>{s.package_snapshot?.name}</td>
                    <td className="fs-12">{s.starts_at?.slice(0, 10)}</td>
                    <td className="fs-12">{s.expires_at?.slice(0, 10)}</td>
                    <td><span className="pill pill-amber">{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KYC({ toast, refresh }) {
  const [aadhaarFile, setAadhaarFile] = useState("");
  const [panFile, setPanFile] = useState("");
  const [bankFile, setBankFile] = useState("");
  const [selfieFile, setSelfieFile] = useState("");
  const [aadhaarNo, setAadhaarNo] = useState("");
  const [panNo, setPanNo] = useState("");
  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [kyc, setKyc] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = () => api.get("/kyc/mine").then((r) => setKyc(r.data));
  useEffect(() => { reload(); }, []);

  const upload = async (file, setter) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("File too large (max 5 MB)", "error"); return; }
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) { toast("Only JPG / PNG / WEBP / PDF allowed", "error"); return; }
    const r = new FileReader();
    r.onload = () => setter(r.result);
    r.readAsDataURL(file);
  };

  const validate = () => {
    if (!aadhaarFile && !panFile) return "Upload at least one identity document (Aadhaar or PAN)";
    const aaNum = aadhaarNo.replace(/\s/g, "");
    if (aadhaarFile && !/^\d{12}$/.test(aaNum)) return "Aadhaar number must be exactly 12 digits";
    if (panFile && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNo.toUpperCase())) return "PAN must be in format ABCDE1234F";
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) { toast(err, "error"); return; }
    setBusy(true);
    try {
      await api.post("/kyc/submit", {
        full_name: fullName, dob,
        aadhaar_number: aadhaarNo.replace(/\s/g, ""), pan_number: panNo.toUpperCase(),
        aadhaar: aadhaarFile, pan: panFile,
        bank_proof: bankFile, selfie: selfieFile,
      });
      toast("KYC submitted for review");
      reload();
      refresh && refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(false);
  };

  const status = kyc?.status;
  const isLocked = status === "pending" || status === "approved";

  return (
    <div className="card card-pad" data-testid="kyc-tab">
      <h2 className="font-serif fs-20 fw-700 mb-8">KYC Verification</h2>
      <p className="text-muted fs-13 mb-20">Verify your identity to unlock payouts, the Verified Badge, and premium features.</p>

      {status && (
        <div className="mb-16">
          <div className={`pill ${status === "approved" ? "pill-green" : status === "rejected" ? "pill-red" : status === "needs_resubmission" ? "pill-amber" : "pill-purple"}`} data-testid="kyc-status">
            Status: {status.replace(/_/g, " ")}
          </div>
          {kyc.reason && (status === "rejected" || status === "needs_resubmission") && (
            <div className="text-muted fs-13 mt-8" data-testid="kyc-reason">Reason: {kyc.reason}</div>
          )}
          {status === "approved" && <div className="text-muted fs-13 mt-8">✓ Verified Badge active on your profile</div>}
        </div>
      )}

      {isLocked ? (
        <div className="empty">
          <div className="empty-title">{status === "approved" ? "You're verified!" : "Review in progress"}</div>
          <p className="text-muted">{status === "approved" ? "Your KYC has been approved." : "Our team will review your submission within 24-48 hours."}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-2 gap-12 mb-12" style={{ marginBottom: 12 }}>
            <div className="field">
              <div className="field-label">Full Name (as per Aadhaar)</div>
              <input className="field-input" placeholder="e.g. Priya Sharma" value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="kyc-name" />
            </div>
            <div className="field">
              <div className="field-label">Date of Birth</div>
              <input type="date" className="field-input" value={dob} onChange={(e) => setDob(e.target.value)} data-testid="kyc-dob" />
            </div>
          </div>

          <div className="field">
            <div className="field-label">Aadhaar Number (12 digits)</div>
            <input className="field-input" placeholder="1234 5678 9012" maxLength={14} value={aadhaarNo} onChange={(e) => setAadhaarNo(e.target.value)} data-testid="kyc-aadhaar-no" />
          </div>
          <div className="field">
            <div className="field-label">Aadhaar Document (JPG/PNG/PDF, max 5 MB)</div>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files[0], setAadhaarFile)} data-testid="kyc-aadhaar" />
            {aadhaarFile && <div className="pill pill-green mt-8" style={{ marginTop: 8 }}>✓ Aadhaar file selected</div>}
          </div>

          <div className="field">
            <div className="field-label">PAN Number</div>
            <input className="field-input" placeholder="ABCDE1234F" maxLength={10} value={panNo} onChange={(e) => setPanNo(e.target.value.toUpperCase())} data-testid="kyc-pan-no" />
          </div>
          <div className="field">
            <div className="field-label">PAN Document</div>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files[0], setPanFile)} data-testid="kyc-pan" />
            {panFile && <div className="pill pill-green mt-8" style={{ marginTop: 8 }}>✓ PAN file selected</div>}
          </div>

          <div className="field">
            <div className="field-label">Bank Proof — Cancelled Cheque / Passbook (optional)</div>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files[0], setBankFile)} data-testid="kyc-bank" />
            {bankFile && <div className="pill pill-green mt-8" style={{ marginTop: 8 }}>✓ Bank proof selected</div>}
          </div>

          <div className="field">
            <div className="field-label">Live Selfie (optional but recommended)</div>
            <input type="file" accept="image/*" capture="user" onChange={(e) => upload(e.target.files[0], setSelfieFile)} data-testid="kyc-selfie" />
            {selfieFile && <div className="pill pill-green mt-8" style={{ marginTop: 8 }}>✓ Selfie selected</div>}
          </div>

          <button className="btn btn-gold" disabled={busy} onClick={submit} data-testid="kyc-submit">
            {busy ? "Submitting..." : status === "needs_resubmission" ? "Resubmit for Review" : "Submit for Review"}
          </button>
        </>
      )}
    </div>
  );
}
