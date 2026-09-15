import React, { useEffect, useState, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import api, { formatApiError as fmt } from "../../lib/api";
import { useToast } from "../../lib/toast";

/**
 * Iter 85 — Manager & CRM UIs (Sec 26-30).
 *
 * Three pages in one module:
 *   • ManagerDashboard     — pipeline counts, my active bookings, quick nav
 *   • LeadBoard            — Kanban across 12 stages
 *   • LeadDetail           — single lead with timeline + assignment picker
 *
 * All three read from /api/leads*, /api/manager/dashboard endpoints
 * already delivered in Iter 84.
 */

const STAGES = [
  { key: "new_lead", label: "New", tint: "sky" },
  { key: "contacted", label: "Contacted", tint: "sky" },
  { key: "requirement_received", label: "Requirement", tint: "cyan" },
  { key: "artist_suggested", label: "Suggested", tint: "cyan" },
  { key: "quotation_sent", label: "Quoted", tint: "gold" },
  { key: "negotiation", label: "Negotiating", tint: "gold" },
  { key: "booking_pending", label: "Booking Pending", tint: "gold" },
  { key: "booking_confirmed", label: "Confirmed", tint: "green" },
  { key: "payment_pending", label: "Payment Pending", tint: "orange" },
  { key: "event_upcoming", label: "Event Upcoming", tint: "green" },
  { key: "event_completed", label: "Event Done", tint: "green" },
  { key: "closed", label: "Closed", tint: "muted" },
];

const money = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n || 0));


// ─── Page 1: Manager Dashboard ─────────────────────────────────────
export function ManagerDashboard() {
  const toast = useToast();
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/manager/dashboard");
        setDash(r.data);
      } catch (e) { toast(fmt(e), "error"); }
      setLoading(false);
    })();
  }, []); // eslint-disable-line

  if (loading) return <div className="pad-24" data-testid="mgr-dash-loading">Loading…</div>;
  if (!dash) return <div className="pad-24">No data</div>;

  const totalLeads = Object.values(dash.counts || {}).reduce((a, b) => a + b, 0);

  return (
    <div className="pad-24" data-testid="manager-dashboard">
      <h1 className="font-serif fs-24 fw-700 mb-16">Manager Dashboard</h1>
      <div className="grid grid-4 gap-12 mb-24">
        <StatCard label="Total Leads" value={totalLeads} testid="stat-total-leads" />
        <StatCard label="Active Bookings" value={dash.active_bookings || 0} testid="stat-active-bookings" />
        <StatCard label="Booking Pending" value={dash.counts.booking_pending || 0} testid="stat-booking-pending" />
        <StatCard label="Event Upcoming" value={dash.counts.event_upcoming || 0} testid="stat-event-upcoming" />
      </div>
      <h2 className="font-serif fs-18 fw-700 mb-12">Pipeline</h2>
      <div className="grid grid-4 gap-8 mb-24">
        {STAGES.map((s) => (
          <Link key={s.key} to={`/manager/leads?stage=${s.key}`}
            className="card card-pad hover-lift" data-testid={`pipeline-${s.key}`}>
            <div className="text-muted fs-12">{s.label}</div>
            <div className="fs-24 fw-700 mt-4">{dash.counts[s.key] || 0}</div>
          </Link>
        ))}
      </div>
      <div className="flex gap-8">
        <Link to="/manager/leads" className="btn btn-gold" data-testid="btn-lead-board">Open Lead Board →</Link>
        <Link to="/manager/leads?stage=new_lead" className="btn btn-ghost">Work New Leads</Link>
        <Link to="/manager/leaderboard" className="btn btn-ghost" data-testid="btn-leaderboard">🏆 Team Leaderboard</Link>
        <Link to="/manager/chat" className="btn btn-ghost" data-testid="btn-chat">💬 Chat Moderation</Link>
      </div>
    </div>
  );
}


function StatCard({ label, value, testid }) {
  return (
    <div className="card card-pad" data-testid={testid}>
      <div className="text-muted fs-13">{label}</div>
      <div className="font-serif fs-28 fw-700 mt-4">{value}</div>
    </div>
  );
}


// ─── Page 2: Lead Board (Kanban) ───────────────────────────────────
export function LeadBoard() {
  const toast = useToast();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get("/leads?limit=500");
      setLeads(r.data.items || []);
    } catch (e) { toast(fmt(e), "error"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const byStage = useMemo(() => {
    const m = {};
    STAGES.forEach((s) => (m[s.key] = []));
    leads.forEach((l) => { (m[l.stage] || (m[l.stage] = [])).push(l); });
    return m;
  }, [leads]);

  const advance = async (lead, newStage) => {
    try {
      await api.patch(`/leads/${lead.id}/stage`, { stage: newStage, note: "Advanced from Kanban" });
      toast(`Moved to ${newStage.replace(/_/g, " ")}`, "success");
      await load();
    } catch (e) { toast(fmt(e), "error"); }
  };

  if (loading) return <div className="pad-24">Loading leads…</div>;

  return (
    <div className="pad-24" data-testid="lead-board">
      <div className="flex-between mb-16">
        <h1 className="font-serif fs-24 fw-700">Lead Board</h1>
        <Link to="/manager/leads/new" className="btn btn-gold" data-testid="btn-new-lead">+ New Lead</Link>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-12" style={{ minWidth: 1800 }}>
          {STAGES.map((s) => (
            <div key={s.key} className="lead-col" style={{ width: 280, flex: "0 0 280px" }} data-testid={`col-${s.key}`}>
              <div className="lead-col-head mb-8">
                <span className="fw-700">{s.label}</span>
                <span className="text-muted fs-12 ml-8">{(byStage[s.key] || []).length}</span>
              </div>
              {(byStage[s.key] || []).map((l) => (
                <div key={l.id} className="card card-pad mb-8" data-testid={`card-lead-${l.id}`}>
                  <div className="fw-700 fs-14" onClick={() => nav(`/manager/leads/${l.id}`)} style={{ cursor: "pointer" }}>
                    {l.customer_name}
                  </div>
                  <div className="text-muted fs-12">{l.event_type} · {l.city || "—"}</div>
                  <div className="text-gold fs-13 mt-4">₹{money(l.budget)}</div>
                  {l.assigned_manager_email && (
                    <div className="text-muted fs-11 mt-4">👤 {l.assigned_manager_email}</div>
                  )}
                  <select className="field-input mt-8" value={l.stage}
                    onChange={(e) => advance(l, e.target.value)}
                    data-testid={`lead-${l.id}-stage-select`}>
                    {STAGES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    <option value="lost_cancelled">Lost / Cancelled</option>
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── Page 3: Lead Detail (timeline + assignment) ───────────────────
export function LeadDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [lead, setLead] = useState(null);
  const [managers, setManagers] = useState([]);
  const [selectedMgr, setSelectedMgr] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.get(`/leads?limit=500`); // simple list-then-filter (a dedicated GET /leads/{id} can come later)
      const found = (r.data.items || []).find((l) => l.id === id);
      setLead(found || null);
    } catch (e) { toast(fmt(e), "error"); }
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/admin/list-users?role=manager");
        setManagers(r.data.items || r.data.users || []);
      } catch {
        setManagers([]);
      }
    })();
  }, []);

  const assign = async () => {
    if (!selectedMgr) return toast("Pick a manager first", "error");
    setSaving(true);
    try {
      await api.post(`/leads/${id}/assign`, { manager_id: selectedMgr, note });
      toast("Assigned", "success");
      setNote("");
      await load();
    } catch (e) { toast(fmt(e), "error"); }
    setSaving(false);
  };

  if (!lead) return <div className="pad-24">Loading lead…</div>;

  return (
    <div className="pad-24" data-testid="lead-detail">
      <Link to="/manager/leads" className="text-muted fs-13">← Back to Board</Link>
      <div className="flex-between mt-8 mb-16">
        <div>
          <h1 className="font-serif fs-24 fw-700">{lead.customer_name}</h1>
          <div className="text-muted fs-13">{lead.company || "Individual"} · {lead.phone}</div>
        </div>
        <div className="pill pill-gold" data-testid="lead-stage-pill">{lead.stage.replace(/_/g, " ")}</div>
      </div>

      <div className="grid grid-2 gap-16 mb-24">
        <div className="card card-pad">
          <h3 className="font-serif fw-700 mb-8">Enquiry</h3>
          <Row k="Event type" v={lead.event_type} />
          <Row k="Event date" v={lead.event_date || "—"} />
          <Row k="Days" v={lead.number_of_days || 1} />
          <Row k="Venue" v={lead.venue || "—"} />
          <Row k="Address" v={lead.venue_address || "—"} />
          <Row k="Budget" v={`₹${money(lead.budget)}`} />
          <Row k="Requirements" v={lead.requirements || "—"} />
          <Row k="Source" v={lead.lead_source} />
        </div>
        <div className="card card-pad">
          <h3 className="font-serif fw-700 mb-8">Assign / Reassign Manager</h3>
          <Row k="Current" v={lead.assigned_manager_email || "Unassigned"} />
          <select className="field-input mb-8" value={selectedMgr} onChange={(e) => setSelectedMgr(e.target.value)}
            data-testid="assign-manager-select">
            <option value="">Choose a manager…</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
          </select>
          <input className="field-input mb-8" placeholder="Note (optional)"
            value={note} onChange={(e) => setNote(e.target.value)} data-testid="assign-note" />
          <button className="btn btn-gold" disabled={saving || !selectedMgr}
            onClick={assign} data-testid="assign-submit-btn">
            {saving ? "Saving…" : "Assign"}
          </button>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="font-serif fw-700 mb-12">Timeline</h3>
        <ul className="timeline" data-testid="lead-timeline">
          {(lead.history || []).slice().reverse().map((h, i) => (
            <li key={i} className="mb-8">
              <div className="fs-13 fw-700">{h.stage?.replace(/_/g, " ")}</div>
              <div className="text-muted fs-12">{h.actor} · {new Date(h.at).toLocaleString()}</div>
              {h.note && <div className="fs-13 mt-4">{h.note}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const Row = ({ k, v }) => (
  <div className="flex-between fs-13 mb-4">
    <span className="text-muted">{k}</span>
    <span className="text-right" style={{ maxWidth: "60%" }}>{v}</span>
  </div>
);
