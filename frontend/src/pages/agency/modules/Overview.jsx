import React, { useEffect, useState } from "react";
import api from "../../../lib/api";

export default function Overview() {
  const [ov, setOv] = useState(null);
  useEffect(() => { api.get("/agency/overview").then((r) => setOv(r.data)).catch(() => {}); }, []);

  return (
    <div data-testid="agency-overview">
      <div className="ag-section-head">
        <div>
          <h2>Agency Overview</h2>
          <div className="fs-13">Everything at a glance — roster, pipeline, recent activity.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div className="ag-card">
          <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Recent Activity</h4>
          {(ov?.recent_activity || []).length === 0 ? (
            <div className="text-muted fs-13">No activity yet. Add your first client, offline artist, or event to start.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {(ov.recent_activity || []).map((a) => (
                <li key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 13 }}>
                  <span className={`ag-badge ${a.kind === "event_created" ? "gold" : a.kind === "followup" ? "violet" : ""}`} style={{ marginRight: 10 }}>
                    {a.kind}
                  </span>
                  {a.title}
                  <span className="text-muted fs-11" style={{ float: "right" }}>
                    {a.created_at ? new Date(a.created_at).toLocaleString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="ag-card">
          <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Quick Actions</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <a href="/agency/artists" className="btn btn-ghost btn-sm" data-testid="qa-artists">Manage Roster</a>
            <a href="/agency/events" className="btn btn-ghost btn-sm" data-testid="qa-events">Create Event</a>
            <a href="/agency/clients" className="btn btn-ghost btn-sm" data-testid="qa-clients">Add Client</a>
            <a href="/agency/finance" className="btn btn-ghost btn-sm" data-testid="qa-finance">Generate Invoice</a>
          </div>
        </div>
      </div>
    </div>
  );
}
