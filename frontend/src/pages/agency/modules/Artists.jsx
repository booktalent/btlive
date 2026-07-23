import React, { useEffect, useState } from "react";
import api from "../../../lib/api";

function OnlineRoster() {
  const [roster, setRoster] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCommission, setInviteCommission] = useState(15);
  const [msg, setMsg] = useState(null);

  const load = () => api.get("/agency/roster").then((r) => setRoster(r.data || [])).catch(() => setRoster([]));
  useEffect(() => { load(); }, []);

  const invite = async () => {
    if (!inviteEmail) return;
    try {
      await api.post("/agency/invite", { artist_email: inviteEmail, commission_pct: Number(inviteCommission) });
      setMsg({ ok: true, text: "Invite sent." }); setInviteEmail("");
      load();
    } catch (e) { setMsg({ ok: false, text: e?.response?.data?.detail || "Failed to invite" }); }
  };
  const remove = async (id) => {
    if (!window.confirm("Remove artist from roster?")) return;
    await api.post(`/agency/remove/${id}`); load();
  };
  const changeCommission = async (id, pct) => {
    try { await api.patch(`/agency/roster/${id}/commission`, { commission_pct: Number(pct) }); load(); }
    catch { /* ignore */ }
  };

  return (
    <div>
      <div className="ag-card" style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Invite BookTalent Artist to Roster</h4>
        <div className="ag-form-grid">
          <label>Artist email
            <input type="email" placeholder="artist@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} data-testid="ag-invite-email" />
          </label>
          <label>Commission %
            <input type="number" min="0" max="50" value={inviteCommission} onChange={(e) => setInviteCommission(e.target.value)} data-testid="ag-invite-commission" />
          </label>
          <label style={{ justifyContent: "flex-end" }}>
            <span>&nbsp;</span>
            <button className="btn btn-gold btn-sm" onClick={invite} data-testid="ag-invite-send">Send Invite</button>
          </label>
        </div>
        {msg && <div className="fs-12 mt-8" style={{ color: msg.ok ? "#6ee7a8" : "#ff8888" }}>{msg.text}</div>}
      </div>

      {roster.length === 0 ? (
        <div className="ag-empty"><h3>No online artists yet</h3><div>Invite BookTalent artists above to build your roster.</div></div>
      ) : (
        <table className="ag-table" data-testid="ag-online-roster">
          <thead><tr><th>Artist</th><th>Category</th><th>Commission %</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.id} data-testid={`ag-roster-row-${r.artist_id}`}>
                <td>
                  <b>{r.stage_name || r.artist_name}</b>
                  <div className="text-muted fs-11">{r.email}</div>
                </td>
                <td>{r.category || "—"}</td>
                <td>
                  <input
                    type="number" min="0" max="50" defaultValue={r.commission_pct || 15}
                    onBlur={(e) => changeCommission(r.artist_id, e.target.value)}
                    style={{ width: 70, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: 6, padding: "6px 8px" }}
                  />
                </td>
                <td><span className={`ag-badge ${r.status === "accepted" ? "ok" : r.status === "pending" ? "warn" : ""}`}>{r.status || "active"}</span></td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(r.artist_id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OfflineArtists() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", category: "", phone: "", email: "", base_price: 0, city: "" });
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/agency/offline-artists").then((r) => setList(r.data || [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return;
    setBusy(true);
    try {
      await api.post("/agency/offline-artists", { ...form, base_price: Number(form.base_price) || 0 });
      setForm({ name: "", category: "", phone: "", email: "", base_price: 0, city: "" }); load();
    } finally { setBusy(false); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete offline artist?")) return;
    await api.delete(`/agency/offline-artists/${id}`); load();
  };

  return (
    <div>
      <div className="ag-card" style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Add Offline Artist</h4>
        <div className="ag-form-grid">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="ag-off-name" /></label>
          <label>Category<input placeholder="e.g. Singer" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>City<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
          <label>Base price (₹)<input type="number" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} /></label>
          <label style={{ justifyContent: "flex-end" }}><span>&nbsp;</span>
            <button className="btn btn-gold btn-sm" disabled={busy} onClick={create} data-testid="ag-off-create">Add Artist</button>
          </label>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="ag-empty"><h3>No offline artists yet</h3><div>These records stay private to your agency — never shown on BookTalent.</div></div>
      ) : (
        <table className="ag-table" data-testid="ag-offline-list">
          <thead><tr><th>Name</th><th>Category</th><th>Contact</th><th>City</th><th>Base ₹</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><b>{a.name}</b>{a.stage_name && <div className="text-muted fs-11">{a.stage_name}</div>}</td>
                <td>{a.category || "—"}</td>
                <td>{a.phone || "—"}<div className="text-muted fs-11">{a.email || ""}</div></td>
                <td>{a.city || "—"}</td>
                <td>{a.base_price?.toLocaleString?.("en-IN") || 0}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(a.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Artists() {
  const [tab, setTab] = useState("online");
  return (
    <div data-testid="agency-artists">
      <div className="ag-section-head">
        <div>
          <h2>Artist Management</h2>
          <div className="fs-13">Unified view — the same artist can be managed both online (BookTalent roster) and offline (private CRM).</div>
        </div>
      </div>

      <div className="ag-tabs">
        <button className={`ag-tab ${tab === "online" ? "active" : ""}`} onClick={() => setTab("online")} data-testid="ag-tab-online">Online Roster</button>
        <button className={`ag-tab ${tab === "offline" ? "active" : ""}`} onClick={() => setTab("offline")} data-testid="ag-tab-offline">Offline Artists</button>
      </div>

      {tab === "online" ? <OnlineRoster /> : <OfflineArtists />}
    </div>
  );
}
