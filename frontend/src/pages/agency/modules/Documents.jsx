import React from "react";

export default function Documents() {
  return (
    <div data-testid="agency-documents">
      <div className="ag-section-head">
        <div><h2>Documents</h2><div className="fs-13">Contracts, agreements, artist docs, client docs — one vault.</div></div>
      </div>
      <div className="ag-card" style={{ padding: 30, textAlign: "center" }}>
        <div style={{ fontSize: 40, opacity: 0.6 }}>📁</div>
        <h3 style={{ fontFamily: "var(--font-serif)", fontSize: 22, marginTop: 10 }}>Attach documents anywhere</h3>
        <p className="text-muted fs-13" style={{ maxWidth: 460, margin: "8px auto" }}>
          Right now, documents live inside each Event and Client record — open a
          client's profile in the CRM to attach or download files. A unified
          vault view with search & tagging is on the way.
        </p>
      </div>
    </div>
  );
}
