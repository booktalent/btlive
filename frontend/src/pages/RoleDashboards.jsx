import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

/* ============================================================
   AGENCY DASHBOARD — roster + invites + bookings + revenue
   ============================================================ */
export function AgencyDashboard() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [roster, setRoster] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCommission, setInviteCommission] = useState(10);

  const refresh = () => {
    api.get("/agency/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/agency/roster").then((r) => setRoster(r.data)).catch(() => {});
    api.get("/agency/bookings").then((r) => setBookings(r.data)).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  const invite = async () => {
    if (!inviteEmail.includes("@")) { toast("Enter a valid artist email", "error"); return; }
    try {
      await api.post("/agency/invite", { artist_email: inviteEmail, commission_pct: inviteCommission });
      toast("Invite sent");
      setInviteEmail("");
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  const remove = async (artist_id) => {
    if (!window.confirm("Remove this artist from your roster?")) return;
    await api.post(`/agency/remove/${artist_id}`);
    toast("Removed");
    refresh();
  };

  if (!user) return null;

  const SIDEBAR = [
    { id: "overview", label: "📊 Overview" },
    { id: "roster", label: "🎤 Roster" },
    { id: "bookings", label: "📋 Bookings" },
    { id: "invite", label: "➕ Invite Artist" },
  ];

  return (
    <div className="dash-wrap" data-testid="agency-dashboard">
      <aside className="sidebar">
        <Link to="/" className="logo mb-20">
          <div className="logo-mark">B</div>
          <span style={{ fontSize: 18 }}>Book<span className="gold">Talent</span></span>
        </Link>
        <div className="text-muted fs-11" style={{ marginBottom: 8 }}>AGENCY</div>
        <div className="fw-700 mb-16">{user.company_name || `${user.first_name} ${user.last_name}`}</div>
        {SIDEBAR.map((x) => (
          <div key={x.id} className={`sb-item ${tab === x.id ? "active" : ""}`} onClick={() => setTab(x.id)} data-testid={`sb-${x.id}`}>
            {x.label}
          </div>
        ))}
        <div className="sb-item" onClick={() => { logout(); nav("/"); }} style={{ marginTop: "auto", color: "var(--white-dim)" }} data-testid="sb-logout">🚪 Logout</div>
      </aside>

      <main className="main">
        <Nav inDash />
        <div style={{ padding: 32 }}>
          {tab === "overview" && stats && (
            <>
              <h1 className="font-serif fs-28 fw-700 mb-24" data-testid="agency-title">Agency Overview</h1>
              <div className="kpi-grid">
                <div className="kpi" data-testid="kpi-roster"><div className="kpi-num text-gold">{stats.roster}</div><div className="kpi-label">Active Artists</div></div>
                <div className="kpi" data-testid="kpi-pending"><div className="kpi-num">{stats.pending_invites}</div><div className="kpi-label">Pending Invites</div></div>
                <div className="kpi" data-testid="kpi-bookings"><div className="kpi-num">{stats.bookings}</div><div className="kpi-label">Bookings</div></div>
                <div className="kpi" data-testid="kpi-gmv"><div className="kpi-num text-gold">{fmtINRFull(stats.gmv)}</div><div className="kpi-label">Roster GMV</div></div>
                <div className="kpi" data-testid="kpi-comm"><div className="kpi-num text-gold">{fmtINRFull(stats.commission_earned)}</div><div className="kpi-label">Commission Earned</div></div>
              </div>
            </>
          )}

          {tab === "roster" && (
            <div className="card" data-testid="agency-roster">
              <div className="card-head"><div className="card-title">🎤 Roster ({roster.length})</div></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Artist</th><th>Category</th><th>City</th><th>Rating</th><th>Commission</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {roster.map((row) => (
                      <tr key={row.id} data-testid={`roster-${row.artist_id}`}>
                        <td className="fw-600">{row.artist?.stage_name || row.artist_email}</td>
                        <td>{row.artist?.category || "—"}</td>
                        <td>{row.artist?.city || "—"}</td>
                        <td>★ {row.artist?.rating_avg || 0} ({row.artist?.review_count || 0})</td>
                        <td>{row.commission_pct}%</td>
                        <td><span className={`pill pill-${row.status === "active" ? "green" : row.status === "pending" ? "amber" : "red"}`}>{row.status}</span></td>
                        <td>
                          {row.status === "active" && (
                            <button className="btn btn-red btn-xs" onClick={() => remove(row.artist_id)} data-testid={`remove-${row.artist_id}`}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "bookings" && (
            <div className="card" data-testid="agency-bookings">
              <div className="card-head"><div className="card-title">📋 Roster Bookings ({bookings.length})</div></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Ref</th><th>Event</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} data-testid={`bk-${b.id}`}>
                        <td><code className="fs-11">{b.ref}</code></td>
                        <td>{b.event_type}</td>
                        <td className="fs-12">{b.event_date}</td>
                        <td>{b.customer_name}</td>
                        <td className="text-gold">{fmtINRFull(b.pricing?.total || 0)}</td>
                        <td><span className={`pill pill-${b.status === "confirmed" ? "green" : b.status === "completed" ? "purple" : "amber"}`}>{b.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "invite" && (
            <div className="card card-pad" style={{ maxWidth: 600 }} data-testid="agency-invite">
              <h2 className="font-serif fs-20 fw-700 mb-16">Invite an Artist to Your Roster</h2>
              <div className="field">
                <div className="field-label">Artist Email</div>
                <input className="field-input" placeholder="artist@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} data-testid="invite-email" />
              </div>
              <div className="field">
                <div className="field-label">Commission % (you'll earn from each booking)</div>
                <input type="number" className="field-input" min={0} max={50} value={inviteCommission} onChange={(e) => setInviteCommission(Number(e.target.value))} data-testid="invite-pct" />
              </div>
              <button className="btn btn-gold" onClick={invite} data-testid="invite-send">Send Invite</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ============================================================
   CORPORATE DASHBOARD — bulk bookings + cost centres
   ============================================================ */
export function CorporateDashboard() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [artists, setArtists] = useState([]);
  const [rows, setRows] = useState([
    { artist_id: "", package_id: "", event_date: "", venue: "", city: "", cost_centre: "", po_number: "", headcount: 100 },
  ]);
  const [pkgsByArtist, setPkgsByArtist] = useState({});

  const refresh = () => {
    api.get("/corporate/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/corporate/bookings").then((r) => setBookings(r.data)).catch(() => {});
    api.get("/artists?limit=200").then((r) => setArtists(r.data)).catch(() => {});
  };
  useEffect(() => { refresh(); }, []);

  const loadPkgs = async (aid) => {
    if (!aid || pkgsByArtist[aid]) return;
    const r = await api.get(`/artists/${aid}`).catch(() => null);
    if (r?.data?.packages) setPkgsByArtist({ ...pkgsByArtist, [aid]: r.data.packages });
  };

  const updateRow = (idx, k, v) => {
    const next = rows.slice();
    next[idx] = { ...next[idx], [k]: v };
    if (k === "artist_id") loadPkgs(v);
    setRows(next);
  };

  const addRow = () => setRows([...rows, { artist_id: "", package_id: "", event_date: "", venue: "", city: "", cost_centre: "", po_number: "", headcount: 100 }]);
  const removeRow = (i) => setRows(rows.filter((_, x) => x !== i));

  const submitBulk = async () => {
    const valid = rows.filter((r) => r.artist_id && r.package_id && r.event_date);
    if (valid.length === 0) { toast("Add at least one complete row", "error"); return; }
    try {
      const r = await api.post("/corporate/bulk-bookings", { bookings: valid });
      toast(`✓ Created ${r.data.created} booking(s)${r.data.errors.length ? ` · ${r.data.errors.length} error(s)` : ""}`);
      setRows([{ artist_id: "", package_id: "", event_date: "", venue: "", city: "", cost_centre: "", po_number: "", headcount: 100 }]);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  if (!user) return null;

  const SIDEBAR = [
    { id: "overview", label: "📊 Overview" },
    { id: "bulk", label: "➕ Bulk Booking" },
    { id: "bookings", label: "📋 All Bookings" },
    { id: "cost", label: "🏷️ Cost Centres" },
  ];

  return (
    <div className="dash-wrap" data-testid="corporate-dashboard">
      <aside className="sidebar">
        <Link to="/" className="logo mb-20"><div className="logo-mark">B</div><span style={{ fontSize: 18 }}>Book<span className="gold">Talent</span></span></Link>
        <div className="text-muted fs-11" style={{ marginBottom: 8 }}>CORPORATE</div>
        <div className="fw-700 mb-16">{user.company_name || `${user.first_name} ${user.last_name}`}</div>
        {SIDEBAR.map((x) => (
          <div key={x.id} className={`sb-item ${tab === x.id ? "active" : ""}`} onClick={() => setTab(x.id)} data-testid={`sb-${x.id}`}>{x.label}</div>
        ))}
        <div className="sb-item" onClick={() => { logout(); nav("/"); }} style={{ marginTop: "auto", color: "var(--white-dim)" }} data-testid="sb-logout">🚪 Logout</div>
      </aside>

      <main className="main">
        <Nav inDash />
        <div style={{ padding: 32 }}>
          {tab === "overview" && stats && (
            <>
              <h1 className="font-serif fs-28 fw-700 mb-24" data-testid="corp-title">Corporate Overview</h1>
              <div className="kpi-grid">
                <div className="kpi" data-testid="kpi-spend"><div className="kpi-num text-gold">{fmtINRFull(stats.total_spend)}</div><div className="kpi-label">Total Spend</div></div>
                <div className="kpi" data-testid="kpi-bookings"><div className="kpi-num">{stats.bookings}</div><div className="kpi-label">Total Bookings</div></div>
                <div className="kpi" data-testid="kpi-cc"><div className="kpi-num">{Object.keys(stats.by_cost_centre || {}).length}</div><div className="kpi-label">Cost Centres</div></div>
              </div>
            </>
          )}

          {tab === "bulk" && (
            <div className="card" data-testid="corp-bulk">
              <div className="card-head"><div className="card-title">➕ Bulk Booking</div></div>
              <div style={{ padding: 14 }}>
                {rows.map((r, i) => (
                  <div key={i} className="card card-pad mb-12" data-testid={`bulk-row-${i}`}>
                    <div className="grid grid-3 gap-12" style={{ marginBottom: 8 }}>
                      <select className="field-input" value={r.artist_id} onChange={(e) => updateRow(i, "artist_id", e.target.value)} data-testid={`bulk-artist-${i}`}>
                        <option value="">Select Artist…</option>
                        {artists.map((a) => <option key={a.user_id} value={a.user_id}>{a.stage_name} · {a.category}</option>)}
                      </select>
                      <select className="field-input" value={r.package_id} onChange={(e) => updateRow(i, "package_id", e.target.value)} disabled={!r.artist_id} data-testid={`bulk-pkg-${i}`}>
                        <option value="">Select Package…</option>
                        {(pkgsByArtist[r.artist_id] || []).map((p) => <option key={p.id} value={p.id}>{p.name} · {fmtINRFull(p.price)}</option>)}
                      </select>
                      <input type="date" className="field-input" value={r.event_date} onChange={(e) => updateRow(i, "event_date", e.target.value)} data-testid={`bulk-date-${i}`} />
                    </div>
                    <div className="grid grid-4 gap-12">
                      <input className="field-input" placeholder="Venue" value={r.venue} onChange={(e) => updateRow(i, "venue", e.target.value)} />
                      <input className="field-input" placeholder="City" value={r.city} onChange={(e) => updateRow(i, "city", e.target.value)} />
                      <input className="field-input" placeholder="Cost Centre" value={r.cost_centre} onChange={(e) => updateRow(i, "cost_centre", e.target.value)} data-testid={`bulk-cc-${i}`} />
                      <input className="field-input" placeholder="PO Number" value={r.po_number} onChange={(e) => updateRow(i, "po_number", e.target.value)} data-testid={`bulk-po-${i}`} />
                    </div>
                    <div className="flex gap-8 mt-8">
                      <input type="number" className="field-input" style={{ maxWidth: 120 }} placeholder="Headcount" value={r.headcount} onChange={(e) => updateRow(i, "headcount", Number(e.target.value))} />
                      {rows.length > 1 && <button className="btn btn-red btn-xs" onClick={() => removeRow(i)}>Remove</button>}
                    </div>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={addRow} data-testid="bulk-add-row">+ Add Another</button>
                <button className="btn btn-gold ml-8" style={{ marginLeft: 8 }} onClick={submitBulk} data-testid="bulk-submit">Submit All</button>
              </div>
            </div>
          )}

          {tab === "bookings" && (
            <div className="card" data-testid="corp-bookings">
              <div className="card-head"><div className="card-title">📋 Bookings ({bookings.length})</div></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Ref</th><th>Date</th><th>Cost Centre</th><th>PO #</th><th>Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} data-testid={`bk-${b.id}`}>
                        <td><code className="fs-11">{b.ref}</code></td>
                        <td className="fs-12">{b.event_date}</td>
                        <td>{b.cost_centre || "—"}</td>
                        <td className="font-mono fs-11">{b.po_number || "—"}</td>
                        <td className="text-gold">{fmtINRFull(b.pricing?.total || 0)}</td>
                        <td><span className={`pill pill-${b.status === "confirmed" ? "green" : b.status === "completed" ? "purple" : "amber"}`}>{b.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "cost" && stats && (
            <div className="card" data-testid="corp-cost">
              <div className="card-head"><div className="card-title">🏷️ Spend by Cost Centre</div></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Cost Centre</th><th>Bookings</th><th>Spend</th></tr></thead>
                  <tbody>
                    {Object.entries(stats.by_cost_centre || {}).map(([cc, v]) => (
                      <tr key={cc} data-testid={`cc-${cc}`}>
                        <td className="fw-600">{cc}</td>
                        <td>{v.bookings}</td>
                        <td className="text-gold">{fmtINRFull(v.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
