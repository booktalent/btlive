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
  // Cross-artist availability lookup
  const [availDate, setAvailDate] = useState("");
  const [availData, setAvailData] = useState(null);
  const [availLoading, setAvailLoading] = useState(false);

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

  // Sprint 6 — inline commission edit
  const [editing, setEditing] = useState({}); // { artist_id: newPctString }
  const startEdit = (row) => setEditing({ ...editing, [row.artist_id]: String(row.commission_pct) });
  const cancelEdit = (id) => { const n = { ...editing }; delete n[id]; setEditing(n); };
  const saveEdit = async (id) => {
    const pct = Number(editing[id]);
    if (isNaN(pct) || pct < 0 || pct > 50) { toast("Commission must be 0-50%", "error"); return; }
    try {
      await api.patch(`/agency/roster/${id}/commission`, { commission_pct: pct });
      toast("Commission updated");
      cancelEdit(id);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  const lookupAvailability = async (d) => {
    if (!d) { setAvailData(null); return; }
    setAvailLoading(true);
    try {
      const r = await api.get(`/agency/availability?date=${d}`);
      setAvailData(r.data);
    } catch (e) {
      toast(formatApiError(e), "error");
    } finally { setAvailLoading(false); }
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
              <h1 className="font-serif fs-28 fw-700 mb-4" data-testid="agency-title">Enterprise Command Center</h1>
              <p className="text-muted fs-13 mb-24">Live pulse of your roster, bookings, and GST across the quarter.</p>

              <div className="kpi-grid mb-24">
                <div className="kpi" data-testid="kpi-roster"><div className="kpi-num text-gold">{stats.roster}</div><div className="kpi-label">Active Artists</div></div>
                <div className="kpi" data-testid="kpi-pending"><div className="kpi-num">{stats.pending_invites}</div><div className="kpi-label">Pending Invites</div></div>
                <div className="kpi" data-testid="kpi-bookings"><div className="kpi-num">{stats.bookings}</div><div className="kpi-label">Bookings</div></div>
                <div className="kpi" data-testid="kpi-gmv"><div className="kpi-num text-gold">{fmtINRFull(stats.gmv)}</div><div className="kpi-label">Roster GMV</div></div>
                <div className="kpi" data-testid="kpi-comm"><div className="kpi-num text-gold">{fmtINRFull(stats.commission_earned)}</div><div className="kpi-label">Commission Earned</div></div>
              </div>

              <div className="smart-panel-grid mb-24">
                {/* Left: Roster performance table */}
                <div className="card card-pad" data-testid="cmd-roster">
                  <div className="smart-panel-head">
                    <span className="smart-panel-icon">🎤</span>
                    <div>
                      <div className="smart-panel-title">Roster Performance</div>
                      <div className="smart-panel-sub">Bookings and revenue per artist this quarter</div>
                    </div>
                  </div>
                  {roster.length === 0 ? (
                    <div className="empty" style={{ padding: 22 }}><div className="empty-icon">🎨</div><div className="empty-title">No artists on your roster yet</div></div>
                  ) : (
                    <table className="table cmd-roster-table">
                      <thead><tr><th>Artist</th><th>City</th><th>Rating</th><th className="text-right">Bookings</th></tr></thead>
                      <tbody>
                        {roster.slice(0, 6).map((r) => (
                          <tr key={r.id}>
                            <td className="fw-600">{r.artist?.stage_name || r.artist_email}</td>
                            <td className="text-muted">{r.artist?.city || "—"}</td>
                            <td className="text-gold">★ {(r.artist?.rating_avg || 0).toFixed(1)}</td>
                            <td className="text-right fw-600">{r.artist?.total_bookings || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {roster.length > 6 && (
                    <div className="text-center mt-12">
                      <button className="btn btn-ghost btn-sm" onClick={() => setTab("roster")}>View all {roster.length} →</button>
                    </div>
                  )}
                </div>

                {/* Right: stacked bulk queue + GST widget */}
                <div className="smart-panel-cell-col">
                  <div className="card card-pad" data-testid="cmd-bulk-queue">
                    <div className="smart-panel-head">
                      <span className="smart-panel-icon" style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>📋</span>
                      <div>
                        <div className="smart-panel-title">Bulk Booking Queue</div>
                        <div className="smart-panel-sub">Bookings awaiting artist confirmation across your roster</div>
                      </div>
                    </div>
                    {(() => {
                      const pend = (bookings || []).filter((b) => b.status === "pending_artist");
                      if (!pend.length) {
                        return <div className="empty" style={{ padding: 18 }}><div className="empty-icon">✨</div><div className="empty-title">Queue is clear</div></div>;
                      }
                      return (
                        <div className="smart-pending-list">
                          {pend.slice(0, 4).map((b) => (
                            <div key={b.id} className="smart-pending-row" data-testid={`bulk-pending-${b.id}`}>
                              <div className="smart-pending-info">
                                <div className="fw-600 fs-13">{b.artist_name || b.artist_id}</div>
                                <div className="text-muted fs-11">{b.customer_name} · {b.event_date}</div>
                              </div>
                              <div className="text-gold fs-13 fw-600">{fmtINRFull(b.pricing?.artist_fee || (b.pricing?.package_fee || 0) + (b.pricing?.addons_total || 0) || 0)}</div>
                            </div>
                          ))}
                          {pend.length > 4 && (
                            <div className="text-center mt-8">
                              <button className="btn btn-ghost btn-sm" onClick={() => setTab("bookings")}>See all {pend.length} pending →</button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Quarterly GST widget */}
                  <div className="card card-pad" data-testid="cmd-gst">
                    <div className="smart-panel-head">
                      <span className="smart-panel-icon" style={{ background: "linear-gradient(135deg, #a78bfa, #6d28d9)" }}>🇮🇳</span>
                      <div>
                        <div className="smart-panel-title">Quarterly GST</div>
                        <div className="smart-panel-sub">18% on Platform Service Fee collected this quarter</div>
                      </div>
                    </div>
                    {(() => {
                      const now = new Date();
                      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
                      const qStart = new Date(now.getFullYear(), qStartMonth, 1);
                      const qBookings = (bookings || []).filter((b) => {
                        const d = new Date(b.event_date || b.created_at || 0);
                        return d >= qStart && ["confirmed", "started", "completed", "reviewed"].includes(b.status);
                      });
                      const platformFee = qBookings.reduce((s, b) => s + Number(b.pricing?.platform_fee || 0), 0);
                      const gst = qBookings.reduce((s, b) => s + Number(b.pricing?.gst || 0), 0);
                      const qLabel = `Q${Math.floor(qStartMonth / 3) + 1} ${now.getFullYear()}`;
                      return (
                        <>
                          <div className="smart-revenue-num" style={{ fontSize: 26 }}>
                            {fmtINRFull(gst)}
                            <span className="smart-revenue-delta up" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>{qLabel}</span>
                          </div>
                          <div className="cmd-gst-detail">
                            <div><span>Platform Fee (5%)</span><strong>{fmtINRFull(platformFee)}</strong></div>
                            <div><span>GST (18% of fee)</span><strong className="text-gold">{fmtINRFull(gst)}</strong></div>
                            <div><span>Confirmed bookings</span><strong>{qBookings.length}</strong></div>
                          </div>
                          <a
                            className="btn btn-gold btn-xs mt-12"
                            href={`${api.defaults.baseURL}/agency/gst-report.csv?quarter=${now.getFullYear()}-Q${Math.floor(qStartMonth / 3) + 1}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="gst-download"
                          >
                            ⬇ Download {qLabel} CSV for CA
                          </a>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Cross-artist Availability lookup */}
              <div className="card card-pad mb-24" data-testid="cmd-cross-availability">
                <div className="smart-panel-head">
                  <span className="smart-panel-icon" style={{ background: "linear-gradient(135deg, #22d3ee, #0891b2)" }}>🔍</span>
                  <div>
                    <div className="smart-panel-title">Cross-artist Availability</div>
                    <div className="smart-panel-sub">Pick any date to see which of your roster is free vs busy</div>
                  </div>
                </div>
                <div className="cross-avail-form">
                  <input
                    type="date"
                    className="field-input"
                    value={availDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => { setAvailDate(e.target.value); lookupAvailability(e.target.value); }}
                    data-testid="cross-avail-date"
                  />
                  {availLoading && <span className="text-muted fs-12">Checking roster…</span>}
                </div>
                {availData && (
                  <div className="cross-avail-lists mt-14">
                    <div className="cross-avail-col">
                      <div className="cross-avail-title free"><span className="dot dot-free" /> Free on {availData.date} · {availData.free.length}</div>
                      {availData.free.length === 0 ? (
                        <div className="text-muted fs-12" style={{ padding: 10 }}>No one is free — consider offering premium rates.</div>
                      ) : (
                        <div className="cross-avail-artists">
                          {availData.free.map((a) => (
                            <div key={a.user_id} className="cross-avail-chip" data-testid={`cross-free-${a.user_id}`}>
                              <div className="fw-600 fs-13">{a.stage_name}</div>
                              <div className="text-muted fs-11">{a.category} · {a.city} · {a.starting_price ? fmtINRFull(a.starting_price) : "—"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="cross-avail-col">
                      <div className="cross-avail-title busy"><span className="dot dot-blocked" /> Busy on {availData.date} · {availData.busy.length}</div>
                      {availData.busy.length === 0 ? (
                        <div className="text-muted fs-12" style={{ padding: 10 }}>Nobody is busy — great day for outbound.</div>
                      ) : (
                        <div className="cross-avail-artists">
                          {availData.busy.map((a) => (
                            <div key={a.user_id} className="cross-avail-chip busy" data-testid={`cross-busy-${a.user_id}`}>
                              <div className="fw-600 fs-13">{a.stage_name}</div>
                              <div className="text-muted fs-11">{a.category} · {a.city}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                        <td>
                          {editing[row.artist_id] !== undefined ? (
                            <div className="flex gap-4 items-center">
                              <input
                                type="number" min={0} max={50}
                                className="field-input"
                                style={{ width: 70, padding: "4px 6px" }}
                                value={editing[row.artist_id]}
                                onChange={(e) => setEditing({ ...editing, [row.artist_id]: e.target.value })}
                                data-testid={`commission-input-${row.artist_id}`}
                              />
                              <span>%</span>
                            </div>
                          ) : (
                            <span data-testid={`commission-${row.artist_id}`}>{row.commission_pct}%</span>
                          )}
                        </td>
                        <td><span className={`pill pill-${row.status === "active" ? "green" : row.status === "pending" ? "amber" : "red"}`}>{row.status}</span></td>
                        <td>
                          {row.status === "active" && (
                            <div className="flex gap-4">
                              {editing[row.artist_id] !== undefined ? (
                                <>
                                  <button className="btn btn-gold btn-xs" onClick={() => saveEdit(row.artist_id)} data-testid={`commission-save-${row.artist_id}`}>Save</button>
                                  <button className="btn btn-ghost btn-xs" onClick={() => cancelEdit(row.artist_id)}>Cancel</button>
                                </>
                              ) : (
                                <>
                                  <button className="btn btn-ghost btn-xs" onClick={() => startEdit(row)} data-testid={`commission-edit-${row.artist_id}`}>Edit %</button>
                                  <button className="btn btn-red btn-xs" onClick={() => remove(row.artist_id)} data-testid={`remove-${row.artist_id}`}>Remove</button>
                                </>
                              )}
                            </div>
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
  // Track a stable per-row id so React keys stay correct even when rows are
  // removed from the middle of the list (avoids the classic index-as-key bug).
  const nextRowKey = React.useRef(1);
  const _newRow = () => ({ _key: nextRowKey.current++, artist_id: "", package_id: "", event_date: "", venue: "", city: "", cost_centre: "", po_number: "", headcount: 100 });

  const [rows, setRows] = useState([_newRow()]);
  const [pkgsByArtist, setPkgsByArtist] = useState({});

  const refresh = () => {
    api.get("/corporate/stats").then((r) => setStats(r.data)).catch(() => {});
    api.get("/corporate/bookings").then((r) => setBookings(r.data)).catch(() => {});
    api.get("/artists/search?limit=200").then((r) => setArtists(r.data.items || [])).catch(() => {});
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

  const addRow = () => setRows([...rows, _newRow()]);
  const removeRow = (i) => setRows(rows.filter((_, x) => x !== i));

  const submitBulk = async () => {
    const valid = rows.filter((r) => r.artist_id && r.package_id && r.event_date);
    if (valid.length === 0) { toast("Add at least one complete row", "error"); return; }
    try {
      const r = await api.post("/corporate/bulk-bookings", { bookings: valid });
      toast(`✓ Created ${r.data.created} booking(s)${r.data.errors.length ? ` · ${r.data.errors.length} error(s)` : ""}`);
      setRows([_newRow()]);
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
                  <div key={r._key} className="card card-pad mb-12" data-testid={`bulk-row-${i}`}>
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
