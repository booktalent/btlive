import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import {
  AdminMaster, AdminBoost, AdminTemplates, AdminFAQs,
  AdminCMS, AdminBroadcast, AdminSettings, AdminAudit, AdminReports,
  AdminReviewsModeration, AdminProviders,
} from "./admin/AdminEnterprise";

const SIDEBAR = [
  { id: "overview", label: "📊 Overview" },
  { id: "artists", label: "🎤 Artists" },
  { id: "bookings", label: "📋 Bookings" },
  { id: "kyc", label: "🪪 KYC Queue" },
  { id: "payouts", label: "💸 Payouts" },
  { id: "coupons", label: "🎫 Coupons" },
  { id: "users", label: "👥 Users" },
  { id: "disputes", label: "⚖️ Disputes" },
  { id: "master", label: "🗂️ Master Data" },
  { id: "boost", label: "🚀 Boost Manager" },
  { id: "templates", label: "📧 Templates" },
  { id: "faqs", label: "❓ FAQs" },
  { id: "cms", label: "📄 CMS Pages" },
  { id: "broadcast", label: "📢 Broadcast" },
  { id: "reports", label: "📈 Reports" },
  { id: "reviews-mod", label: "🛡️ Reviews Moderation" },
  { id: "providers", label: "🔌 Providers" },
  { id: "settings", label: "⚙️ Settings" },
  { id: "audit", label: "🛡️ Audit Logs" },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState({});

  useEffect(() => {
    if (!user) { nav("/login"); return; }
    if (user.role !== "admin") { nav("/"); return; }
    api.get("/admin/stats").then(r => setStats(r.data));
    // eslint-disable-next-line
  }, [user]);

  if (!user || user.role !== "admin") return null;

  return (
    <div className="dash-wrap" data-testid="admin-dashboard">
      <aside className="sidebar">
        <Link to="/" className="logo mb-20"><div className="logo-mark">B</div><span style={{ fontSize: 18 }}>Book<span className="gold">Talent</span></span></Link>
        <div className="sb-section">Admin Panel</div>
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
            <div><h1>Platform Overview</h1><p>All systems operational</p></div>
          </div>

          <div className="kpi-grid">
            <Kpi icon="💰" cls="kpi-icon-gold" num={fmtINRFull(stats.gmv || 0)} label="Marketplace GMV (artist fees)" />
            <Kpi icon="📋" cls="kpi-icon-purple" num={stats.total_bookings || 0} label="Bookings" />
            <Kpi icon="👥" cls="kpi-icon-green" num={stats.total_users || 0} label="Users" />
            <Kpi icon="🏦" cls="kpi-icon-blue" num={fmtINRFull(stats.platform_revenue || 0)} label="Platform Service Revenue" />
          </div>

          <div className="kpi-grid mb-24">
            <Kpi icon="⚖" cls="kpi-icon-amber" num={fmtINRFull(stats.escrow || 0)} label="Escrow" />
            <Kpi icon="↑" cls="kpi-icon-purple" num={stats.pending_payouts || 0} label="Pending Payouts" />
            <Kpi icon="🪪" cls="kpi-icon-blue" num={stats.pending_kyc || 0} label="KYC Pending" />
            <Kpi icon="⚠️" cls="kpi-icon-red" num={stats.open_disputes || 0} label="Open Disputes" />
          </div>

          {tab === "overview" && <OverviewAdmin stats={stats} />}
          {tab === "artists" && <AdminArtists toast={toast} />}
          {tab === "bookings" && <AdminBookings />}
          {tab === "kyc" && <AdminKYC toast={toast} />}
          {tab === "payouts" && <AdminPayouts toast={toast} />}
          {tab === "coupons" && <AdminCoupons toast={toast} />}
          {tab === "users" && <AdminUsers />}
          {tab === "disputes" && <AdminDisputes toast={toast} />}
          {tab === "master" && <AdminMaster toast={toast} />}
          {tab === "boost" && <AdminBoost toast={toast} />}
          {tab === "templates" && <AdminTemplates toast={toast} />}
          {tab === "faqs" && <AdminFAQs toast={toast} />}
          {tab === "cms" && <AdminCMS toast={toast} />}
          {tab === "broadcast" && <AdminBroadcast toast={toast} />}
          {tab === "reports" && <AdminReports />}
          {tab === "reviews-mod" && <AdminReviewsModeration toast={toast} />}
          {tab === "providers" && <AdminProviders toast={toast} />}
          {tab === "settings" && <AdminSettings toast={toast} />}
          {tab === "audit" && <AdminAudit />}
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

function OverviewAdmin({ stats }) {
  return (
    <div className="card card-pad" data-testid="admin-overview">
      <h3 className="font-serif fs-20 fw-700 mb-16">Quick Stats</h3>
      <div className="grid grid-3">
        <div className="card card-pad" data-testid="stat-total-artists"><div className="text-muted fs-11">Total Artists</div><div className="fs-20 fw-700">{stats.total_artists ?? 0}</div></div>
        <div className="card card-pad" data-testid="stat-total-customers"><div className="text-muted fs-11">Total Customers</div><div className="fs-20 fw-700">{stats.total_customers ?? 0}</div></div>
        <div className="card card-pad" data-testid="stat-avg-rating"><div className="text-muted fs-11">Avg Rating</div><div className="fs-20 fw-700 text-gold">★ {stats.avg_rating ?? 0}</div></div>
        <div className="card card-pad" data-testid="stat-bookings-today"><div className="text-muted fs-11">Bookings Today</div><div className="fs-20 fw-700">{stats.bookings_today ?? 0}</div></div>
        <div className="card card-pad" data-testid="stat-pending-bookings"><div className="text-muted fs-11">Pending Bookings</div><div className="fs-20 fw-700">{stats.pending_bookings ?? 0}</div></div>
      </div>
    </div>
  );
}

function AdminArtists({ toast }) {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/admin/artists").then(r => setList(r.data)); }, []);
  const feature = async (uid) => { await api.post(`/admin/artists/${uid}/feature`); toast("Toggled"); api.get("/admin/artists").then(r => setList(r.data)); };
  const suspend = async (uid) => { await api.post(`/admin/artists/${uid}/suspend`); toast("Updated"); api.get("/admin/artists").then(r => setList(r.data)); };
  return (
    <div className="card" data-testid="admin-artists">
      <div className="card-head"><div className="card-title">🎤 Artists ({list.length})</div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Artist</th><th>Category</th><th>City</th><th>Rating</th><th>Events</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} data-testid={`artist-row-${a.user_id}`}>
                <td><div className="fw-600">{a.stage_name}</div><div className="text-muted fs-11">{a.user?.email}</div></td>
                <td>{a.category}</td>
                <td>{a.city}</td>
                <td className="text-gold">★ {a.rating_avg?.toFixed(1)}</td>
                <td>{a.events_done}</td>
                <td>
                  {a.kyc_status === "approved" && <span className="pill pill-green">Verified</span>}
                  {a.kyc_status === "pending" && <span className="pill pill-amber">Pending</span>}
                  {a.is_featured && <span className="pill pill-gold ml-8" style={{ marginLeft: 8 }}>Featured</span>}
                </td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={() => feature(a.user_id)} data-testid={`feature-${a.user_id}`}>{a.is_featured ? "Unfeature" : "Feature"}</button>
                  <button className="btn btn-red btn-xs" onClick={() => suspend(a.user_id)} data-testid={`suspend-${a.user_id}`} style={{ marginLeft: 6 }}>Suspend</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminBookings() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/admin/bookings").then(r => setList(r.data)); }, []);
  return (
    <div className="card" data-testid="admin-bookings">
      <div className="card-head"><div className="card-title">📋 All Bookings ({list.length})</div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Ref</th><th>Customer</th><th>Event</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id} data-testid={`admin-booking-${b.id}`}>
                <td className="font-mono text-gold fs-11">{b.ref}</td>
                <td>{b.customer_name}</td>
                <td>{b.event_type}<br/><span className="text-muted fs-11">{b.venue}, {b.city}</span></td>
                <td className="fs-12">{b.event_date}</td>
                <td className="text-gold font-serif fs-16 fw-700">{fmtINRFull(b.pricing?.total || 0)}</td>
                <td><span className="pill pill-purple">{b.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminKYC({ toast }) {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState("pending");
  const [expanded, setExpanded] = useState(null);
  const reload = () => api.get(`/admin/kyc?status=${status}`).then((r) => setList(r.data));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [status]);

  const decide = async (artist_id, decision) => {
    let reason = "";
    if (decision === "reject" || decision === "request_resubmission") {
      reason = window.prompt(`Reason for ${decision === "reject" ? "rejection" : "resubmission"}:`, "") || "";
      if (!reason.trim()) { toast("Reason is required", "error"); return; }
    }
    try {
      await api.post("/admin/kyc/decide", { artist_id, decision, reason });
      toast(`KYC ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "resubmission requested"}`);
      reload();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  return (
    <div className="card" data-testid="admin-kyc">
      <div className="card-head" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <div className="card-title">🪪 KYC Queue ({list.length})</div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input" style={{ width: 200 }} data-testid="kyc-status-filter">
          <option value="pending">Pending</option>
          <option value="needs_resubmission">Needs Resubmission</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      <div style={{ padding: 14 }}>
        {list.length === 0 && <div className="empty"><div className="empty-icon">🪪</div><div className="empty-title">No KYC records</div></div>}
        {list.map((k) => {
          const isOpen = expanded === k.user_id;
          return (
            <div key={k.user_id} className="card card-pad mb-12" data-testid={`kyc-row-${k.user_id}`} style={{ marginBottom: 12 }}>
              <div className="flex items-center gap-16">
                <div className="avatar">{k.user?.first_name?.[0]}</div>
                <div style={{ flex: 1 }}>
                  <div className="fw-600">
                    {k.user?.first_name} {k.user?.last_name}
                    {k.artist_profile?.stage_name && <span className="text-muted fs-12" style={{ marginLeft: 8 }}>· {k.artist_profile.stage_name}</span>}
                  </div>
                  <div className="text-muted fs-12">{k.user?.email} · Submitted {k.submitted_at?.slice(0, 10)} · <span className={`pill pill-${k.status === "approved" ? "green" : k.status === "rejected" ? "red" : "amber"}`}>{k.status}</span></div>
                  <div className="text-muted fs-11 mt-4">Docs: {Object.keys(k.documents || {}).join(", ") || "—"}{k.pan_number && ` · PAN ${k.pan_number}`}{k.aadhaar_number_masked && ` · Aadhaar ${k.aadhaar_number_masked}`}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(isOpen ? null : k.user_id)} data-testid={`kyc-view-${k.user_id}`}>{isOpen ? "Hide" : "View"}</button>
                {k.status === "pending" || k.status === "needs_resubmission" ? (
                  <>
                    <button className="btn btn-green btn-sm" onClick={() => decide(k.user_id, "approve")} data-testid={`kyc-approve-${k.user_id}`}>✓ Approve</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => decide(k.user_id, "request_resubmission")} data-testid={`kyc-resub-${k.user_id}`}>↻ Resubmit</button>
                    <button className="btn btn-red btn-sm" onClick={() => decide(k.user_id, "reject")} data-testid={`kyc-reject-${k.user_id}`}>✕ Reject</button>
                  </>
                ) : null}
              </div>
              {isOpen && k.documents && (
                <div className="grid grid-3 gap-12 mt-12" style={{ marginTop: 12 }} data-testid={`kyc-docs-${k.user_id}`}>
                  {Object.entries(k.documents).map(([field, mid]) => (
                    <div key={field} className="card card-pad" style={{ textAlign: "center" }}>
                      <div className="text-muted fs-11 mb-4" style={{ marginBottom: 4 }}>{field.toUpperCase()}</div>
                      <a href={`${api.defaults.baseURL}/media/${mid}`} target="_blank" rel="noreferrer" data-testid={`kyc-doc-${k.user_id}-${field}`}>
                        <img src={`${api.defaults.baseURL}/media/${mid}/thumb`} alt={field} style={{ maxWidth: "100%", borderRadius: 8 }} onError={(e) => { e.target.style.display = "none"; e.target.parentElement.innerHTML += '<div style="font-size:48px">📄</div>'; }} />
                      </a>
                    </div>
                  ))}
                </div>
              )}
              {k.reason && (k.status === "rejected" || k.status === "needs_resubmission") && (
                <div className="text-muted fs-12 mt-8" style={{ marginTop: 8 }}>Reason: {k.reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminPayouts({ toast }) {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/admin/withdrawals").then(r => setList(r.data)); }, []);
  const release = async (wid) => {
    await api.post(`/admin/withdrawals/${wid}/release`);
    toast("Released");
    api.get("/admin/withdrawals").then(r => setList(r.data));
  };
  return (
    <div className="card" data-testid="admin-payouts">
      <div className="card-head"><div className="card-title">💸 Withdrawal Requests ({list.length})</div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>User</th><th>Amount</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id} data-testid={`withdraw-${w.id}`}>
                <td>{w.user?.first_name} {w.user?.last_name}</td>
                <td className="text-gold font-serif fs-16 fw-700">{fmtINRFull(w.amount)}</td>
                <td className="text-muted fs-12">{w.created_at?.slice(0, 10)}</td>
                <td><span className={`pill ${w.status === "pending" ? "pill-amber" : "pill-green"}`}>{w.status}</span></td>
                <td>
                  {w.status === "pending" && (
                    <button className="btn btn-green btn-xs" onClick={() => release(w.id)} data-testid={`release-${w.id}`}>Release</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminCoupons({ toast }) {
  const [analytics, setAnalytics] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [drillIn, setDrillIn] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [form, setForm] = useState({ code: "", description: "", discount_type: "percent", discount_value: 10, max_uses: 100, per_user_limit: 1, expires_at: "2026-12-31", min_order: 0, applies_to: "all", active: true });
  const reload = () => api.get("/admin/coupons/analytics").then(r => setAnalytics(r.data));
  useEffect(() => { reload(); }, []);
  const create = async () => {
    try { await api.post("/admin/coupons", form); toast("Created"); setShowAdd(false); reload(); }
    catch (e) { toast(formatApiError(e), "error"); }
  };
  const del = async (id) => { if (!window.confirm("Delete coupon?")) return; await api.delete(`/admin/coupons/${id}`); reload(); };
  const drill = async (c) => {
    setDrillIn(c);
    const r = await api.get(`/admin/coupons/${c.id}/redemptions`);
    setLedger(r.data);
  };

  return (
    <div className="card" data-testid="admin-coupons">
      <div className="card-head">
        <div className="card-title">🎫 Coupons & Analytics ({analytics.length})</div>
        <button className="btn btn-gold btn-sm" onClick={() => setShowAdd(true)} data-testid="add-coupon-btn">+ New Coupon</button>
      </div>

      <div className="kpi-grid" style={{ padding: "12px 14px 0" }}>
        <div className="kpi" data-testid="coupon-kpi-uses"><div className="kpi-num">{analytics.reduce((s, c) => s + c.uses, 0)}</div><div className="kpi-label">Total Redemptions</div></div>
        <div className="kpi" data-testid="coupon-kpi-discount"><div className="kpi-num text-gold">{fmtINRFull(analytics.reduce((s, c) => s + c.total_discount, 0))}</div><div className="kpi-label">Total Discount Given</div></div>
        <div className="kpi" data-testid="coupon-kpi-gmv"><div className="kpi-num text-gold">{fmtINRFull(analytics.reduce((s, c) => s + c.total_gmv, 0))}</div><div className="kpi-label">Coupon-Driven GMV</div></div>
        <div className="kpi" data-testid="coupon-kpi-active"><div className="kpi-num">{analytics.filter(c => c.active).length}</div><div className="kpi-label">Active Coupons</div></div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Code</th><th>Discount</th><th>Uses</th><th>Discount Given</th><th>GMV Driven</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {analytics.map((c) => (
              <tr key={c.id} data-testid={`coupon-${c.code}`}>
                <td><code style={{ color: "var(--gold-light)", background: "var(--gold-dim)", padding: "3px 8px", borderRadius: 5 }}>{c.code}</code></td>
                <td>{c.discount_type === "percent" ? `${c.discount_value}%` : fmtINRFull(c.discount_value)}</td>
                <td>{c.uses} / {c.max_uses}</td>
                <td className="text-gold">{fmtINRFull(c.total_discount)}</td>
                <td className="text-gold">{fmtINRFull(c.total_gmv)}</td>
                <td className="fs-12 text-muted">{c.expires_at}</td>
                <td><span className={`pill ${c.active ? "pill-green" : "pill-red"}`}>{c.active ? "Active" : "Inactive"}</span></td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={() => drill(c)} data-testid={`drill-coupon-${c.id}`}>Ledger</button>
                  <button className="btn btn-red btn-xs" onClick={() => del(c.id)} style={{ marginLeft: 6 }} data-testid={`del-coupon-${c.id}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="modal-bg" onClick={() => setShowAdd(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">New Coupon</div>
            <div className="field"><div className="field-label">Code</div><input className="field-input" value={form.code} onChange={(e) => setForm({...form, code: e.target.value.toUpperCase()})} data-testid="coupon-code" /></div>
            <div className="field"><div className="field-label">Description</div><input className="field-input" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} /></div>
            <div className="field-row">
              <div className="field"><div className="field-label">Type</div>
                <select className="field-input" value={form.discount_type} onChange={(e) => setForm({...form, discount_type: e.target.value})}>
                  <option value="percent">Percent</option><option value="flat">Flat ₹</option>
                </select>
              </div>
              <div className="field"><div className="field-label">Value</div><input type="number" className="field-input" value={form.discount_value} onChange={(e) => setForm({...form, discount_value: Number(e.target.value)})} data-testid="coupon-value" /></div>
            </div>
            <div className="field-row">
              <div className="field"><div className="field-label">Max Uses (total)</div><input type="number" className="field-input" value={form.max_uses} onChange={(e) => setForm({...form, max_uses: Number(e.target.value)})} /></div>
              <div className="field"><div className="field-label">Per User Limit</div><input type="number" className="field-input" value={form.per_user_limit} onChange={(e) => setForm({...form, per_user_limit: Number(e.target.value)})} /></div>
            </div>
            <div className="field-row">
              <div className="field"><div className="field-label">Min Order ₹</div><input type="number" className="field-input" value={form.min_order} onChange={(e) => setForm({...form, min_order: Number(e.target.value)})} /></div>
              <div className="field"><div className="field-label">Expires</div><input type="date" className="field-input" value={form.expires_at} onChange={(e) => setForm({...form, expires_at: e.target.value})} /></div>
            </div>
            <div className="field"><div className="field-label">Applies To</div>
              <select className="field-input" value={form.applies_to} onChange={(e) => setForm({...form, applies_to: e.target.value})}>
                <option value="all">All bookings</option>
                <option value="wedding">Weddings only</option>
                <option value="corporate">Corporate only</option>
                <option value="birthday">Birthdays only</option>
              </select>
            </div>
            <div className="flex gap-12">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-gold" style={{ flex: 1 }} onClick={create} data-testid="save-coupon">Create</button>
            </div>
          </div>
        </div>
      )}

      {drillIn && (
        <div className="modal-bg" onClick={() => setDrillIn(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-title">Redemption Ledger — <code style={{ color: "var(--gold)" }}>{drillIn.code}</code></div>
            <p className="text-muted fs-13 mb-12">{ledger.length} redemptions · ₹{drillIn.total_discount.toLocaleString("en-IN")} discount given</p>
            <div className="table-wrap" style={{ maxHeight: 400, overflow: "auto" }}>
              <table className="table">
                <thead><tr><th>When</th><th>User</th><th>Booking</th><th>Discount</th><th>Total</th></tr></thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={r.id} data-testid={`ledger-${r.id}`}>
                      <td className="fs-11 text-muted">{r.created_at?.slice(0, 19).replace("T", " ")}</td>
                      <td>{r.user?.email || r.user_id?.slice(0, 8)}</td>
                      <td><code className="fs-11">{r.booking?.ref || r.booking_id?.slice(0, 8)}</code></td>
                      <td className="text-gold">{fmtINRFull(r.discount_amount)}</td>
                      <td>{fmtINRFull(r.booking_total || 0)}</td>
                    </tr>
                  ))}
                  {ledger.length === 0 && <tr><td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 20 }}>No redemptions yet</td></tr>}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost mt-12" onClick={() => setDrillIn(null)} style={{ marginTop: 12 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminUsers() {
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState("");
  useEffect(() => { api.get(`/admin/users${filter ? `?role=${filter}` : ""}`).then(r => setList(r.data)); }, [filter]);
  return (
    <div className="card" data-testid="admin-users">
      <div className="card-head">
        <div className="card-title">👥 Users ({list.length})</div>
        <select className="field-input" style={{ maxWidth: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="user-role-filter">
          <option value="">All Roles</option>
          <option value="customer">Customers</option>
          <option value="artist">Artists</option>
          <option value="agency">Agencies</option>
          <option value="corporate">Corporate</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Joined</th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} data-testid={`user-${u.id}`}>
                <td>{u.first_name} {u.last_name}</td>
                <td className="text-muted">{u.email}</td>
                <td><span className="pill pill-purple">{u.role}</span></td>
                <td>{u.phone || "—"}</td>
                <td className="fs-12 text-muted">{u.created_at?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminDisputes({ toast }) {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/admin/disputes").then(r => setList(r.data)); }, []);
  const resolve = async (did, decision) => {
    await api.post(`/admin/disputes/${did}/resolve`, { decision });
    toast("Resolved");
    api.get("/admin/disputes").then(r => setList(r.data));
  };
  return (
    <div className="card" data-testid="admin-disputes">
      <div className="card-head"><div className="card-title">⚖️ Disputes ({list.length})</div></div>
      <div style={{ padding: 14 }}>
        {list.length === 0 && <div className="empty"><div className="empty-icon">⚖️</div><div className="empty-title">No disputes</div></div>}
        {list.map((d) => (
          <div key={d.id} className="card card-pad mb-12" data-testid={`dispute-${d.id}`}>
            <div className="fw-600 mb-4">{d.reason}</div>
            <div className="text-muted fs-12 mb-8">{d.description}</div>
            <div className="flex gap-8">
              <button className="btn btn-green btn-xs" onClick={() => resolve(d.id, "release")}>Release to Artist</button>
              <button className="btn btn-red btn-xs" onClick={() => resolve(d.id, "refund")}>Refund Customer</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
