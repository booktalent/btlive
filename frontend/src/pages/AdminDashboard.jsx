import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

const SIDEBAR = [
  { id: "overview", label: "📊 Overview" },
  { id: "artists", label: "🎤 Artists" },
  { id: "bookings", label: "📋 Bookings" },
  { id: "kyc", label: "🪪 KYC Queue" },
  { id: "payouts", label: "💸 Payouts" },
  { id: "coupons", label: "🎫 Coupons" },
  { id: "users", label: "👥 Users" },
  { id: "disputes", label: "⚖️ Disputes" },
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
            <Kpi icon="💰" cls="kpi-icon-gold" num={fmtINRFull(stats.gmv || 0)} label="Total GMV" />
            <Kpi icon="📋" cls="kpi-icon-purple" num={stats.total_bookings || 0} label="Bookings" />
            <Kpi icon="👥" cls="kpi-icon-green" num={stats.total_users || 0} label="Users" />
            <Kpi icon="🏦" cls="kpi-icon-blue" num={fmtINRFull(stats.platform_revenue || 0)} label="Platform Revenue" />
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
        <div className="card card-pad"><div className="text-muted fs-11">Total Artists</div><div className="fs-20 fw-700">{stats.total_artists}</div></div>
        <div className="card card-pad"><div className="text-muted fs-11">Total Customers</div><div className="fs-20 fw-700">{stats.total_customers}</div></div>
        <div className="card card-pad"><div className="text-muted fs-11">Avg Rating</div><div className="fs-20 fw-700 text-gold">★ {stats.avg_rating}</div></div>
        <div className="card card-pad"><div className="text-muted fs-11">Bookings Today</div><div className="fs-20 fw-700">{stats.bookings_today}</div></div>
        <div className="card card-pad"><div className="text-muted fs-11">Pending Bookings</div><div className="fs-20 fw-700">{stats.pending_bookings}</div></div>
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
  useEffect(() => { api.get("/admin/kyc").then(r => setList(r.data)); }, []);
  const decide = async (artist_id, decision) => {
    await api.post("/admin/kyc/decide", { artist_id, decision });
    toast(`KYC ${decision}d`);
    api.get("/admin/kyc").then(r => setList(r.data));
  };
  return (
    <div className="card" data-testid="admin-kyc">
      <div className="card-head"><div className="card-title">🪪 KYC Queue ({list.length})</div></div>
      <div style={{ padding: 14 }}>
        {list.length === 0 && <div className="empty"><div className="empty-icon">🪪</div><div className="empty-title">No pending KYC</div></div>}
        {list.map((k) => (
          <div key={k.user_id} className="card card-pad mb-12 flex items-center gap-16" data-testid={`kyc-row-${k.user_id}`}>
            <div className="avatar">{k.user?.first_name?.[0]}</div>
            <div style={{ flex: 1 }}>
              <div className="fw-600">{k.user?.first_name} {k.user?.last_name}</div>
              <div className="text-muted fs-12">{k.user?.email} · Submitted {k.submitted_at?.slice(0, 10)}</div>
              <div className="text-muted fs-11 mt-4">Docs: {Object.keys(k.documents || {}).join(", ")}</div>
            </div>
            <button className="btn btn-green btn-sm" onClick={() => decide(k.user_id, "approve")} data-testid={`kyc-approve-${k.user_id}`}>✓ Approve</button>
            <button className="btn btn-red btn-sm" onClick={() => decide(k.user_id, "reject")} data-testid={`kyc-reject-${k.user_id}`}>✕ Reject</button>
          </div>
        ))}
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
  const [list, setList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: "", description: "", discount_type: "percent", discount_value: 10, max_uses: 100, expires_at: "2026-12-31", min_order: 0, applies_to: "all", active: true });
  const reload = () => api.get("/admin/coupons").then(r => setList(r.data));
  useEffect(reload, []);
  const create = async () => {
    try { await api.post("/admin/coupons", form); toast("Created"); setShowAdd(false); reload(); }
    catch (e) { toast(formatApiError(e), "error"); }
  };
  const del = async (id) => { await api.delete(`/admin/coupons/${id}`); reload(); };
  return (
    <div className="card" data-testid="admin-coupons">
      <div className="card-head">
        <div className="card-title">🎫 Coupons ({list.length})</div>
        <button className="btn btn-gold btn-sm" onClick={() => setShowAdd(true)} data-testid="add-coupon-btn">+ New Coupon</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Code</th><th>Discount</th><th>Usage</th><th>Expires</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} data-testid={`coupon-${c.code}`}>
                <td><code style={{ color: "var(--gold-light)", background: "var(--gold-dim)", padding: "3px 8px", borderRadius: 5 }}>{c.code}</code></td>
                <td>{c.discount_type === "percent" ? `${c.discount_value}%` : fmtINRFull(c.discount_value)}</td>
                <td>{c.usage_count || 0} / {c.max_uses}</td>
                <td className="fs-12 text-muted">{c.expires_at}</td>
                <td><span className={`pill ${c.active ? "pill-green" : "pill-red"}`}>{c.active ? "Active" : "Inactive"}</span></td>
                <td><button className="btn btn-red btn-xs" onClick={() => del(c.id)} data-testid={`del-coupon-${c.id}`}>Delete</button></td>
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
              <div className="field"><div className="field-label">Max Uses</div><input type="number" className="field-input" value={form.max_uses} onChange={(e) => setForm({...form, max_uses: Number(e.target.value)})} /></div>
              <div className="field"><div className="field-label">Expires</div><input type="date" className="field-input" value={form.expires_at} onChange={(e) => setForm({...form, expires_at: e.target.value})} /></div>
            </div>
            <div className="flex gap-12">
              <button className="btn btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-gold" style={{ flex: 1 }} onClick={create} data-testid="save-coupon">Create</button>
            </div>
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
