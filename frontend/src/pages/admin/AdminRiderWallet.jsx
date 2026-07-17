import React, { useCallback, useEffect, useState } from "react";
import api, { formatApiError } from "../../lib/api";

/**
 * Admin Rider Wallet — CRUD for curated travel partners.
 * Vendors surface to customers in the BookingFlow travel block.
 */
export default function AdminRiderWallet({ toast }) {
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(null);
  const [typeFilter, setTypeFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/admin/rider-wallet/vendors");
      setList(r.data);
    } catch (e) { toast(formatApiError(e), "error"); }
  }, [toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async (v) => {
    try {
      if (v.id) {
        const { id, created_at, updated_at, ...patch } = v;
        await api.patch(`/admin/rider-wallet/vendors/${id}`, patch);
        toast("Vendor updated");
      } else {
        await api.post("/admin/rider-wallet/vendors", v);
        toast("Vendor created");
      }
      setModal(null);
      refresh();
    } catch (e) { toast(formatApiError(e), "error"); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this vendor?")) return;
    try { await api.delete(`/admin/rider-wallet/vendors/${id}`); toast("Deleted"); refresh(); }
    catch (e) { toast(formatApiError(e), "error"); }
  };

  const filtered = typeFilter ? list.filter((v) => v.type === typeFilter) : list;

  const TYPE_ICON = { hotel: "🏨", flight: "✈️", transport: "🚗" };

  return (
    <div className="card" data-testid="admin-rider-wallet">
      <div className="card-head" style={{ justifyContent: "space-between" }}>
        <div className="card-title">✈️ Rider Wallet ({filtered.length})</div>
        <div className="flex gap-8">
          <select className="field-input" style={{ maxWidth: 160 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} data-testid="rider-type-filter">
            <option value="">All Types</option>
            <option value="hotel">Hotels</option>
            <option value="flight">Flights</option>
            <option value="transport">Transport</option>
          </select>
          <button className="btn btn-gold btn-sm" onClick={() => setModal({ type: "hotel", name: "", tagline: "", city: "", discount_pct: 10, cta_label: "Get Quote", is_active: true, is_featured: false })} data-testid="add-vendor-btn">+ Add Vendor</button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Type</th><th>Name</th><th>Coverage</th><th>Discount</th><th>Featured</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} data-testid={`vendor-${v.id}`}>
                <td>{TYPE_ICON[v.type]} {v.type}</td>
                <td><div className="fw-600">{v.name}</div><div className="text-muted fs-11">{v.tagline}</div></td>
                <td>{v.city || "Nationwide"}</td>
                <td className="text-gold fw-700">{v.discount_pct}%</td>
                <td>{v.is_featured ? "★" : "—"}</td>
                <td><span className={`pill ${v.is_active ? "pill-green" : "pill-red"}`}>{v.is_active ? "Active" : "Off"}</span></td>
                <td>
                  <button className="btn btn-ghost btn-xs" onClick={() => setModal(v)} data-testid={`edit-vendor-${v.id}`}>Edit</button>
                  <button className="btn btn-red btn-xs" onClick={() => del(v.id)} data-testid={`del-vendor-${v.id}`} style={{ marginLeft: 6 }}>Delete</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="text-muted text-center" style={{ padding: 20 }}>No vendors yet</td></tr>}
          </tbody>
        </table>
      </div>
      {modal && <VendorModal item={modal} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

function VendorModal({ item, onSave, onClose }) {
  const [v, setV] = useState({ discount_pct: 0, is_active: true, is_featured: false, cta_label: "Get Quote", ...item });
  return (
    <div className="modal-bg" onClick={onClose} data-testid="vendor-modal">
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-title">{item.id ? "Edit" : "New"} Vendor</div>
        <div className="field-row">
          <div className="field">
            <div className="field-label">Type *</div>
            <select className="field-input" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} data-testid="vendor-type">
              <option value="hotel">🏨 Hotel</option>
              <option value="flight">✈️ Flight</option>
              <option value="transport">🚗 Transport</option>
            </select>
          </div>
          <div className="field">
            <div className="field-label">City (leave empty = nationwide)</div>
            <input className="field-input" value={v.city || ""} onChange={(e) => setV({ ...v, city: e.target.value })} placeholder="Mumbai" data-testid="vendor-city" />
          </div>
        </div>
        <div className="field"><div className="field-label">Name *</div>
          <input className="field-input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="vendor-name" /></div>
        <div className="field"><div className="field-label">Tagline</div>
          <input className="field-input" value={v.tagline || ""} onChange={(e) => setV({ ...v, tagline: e.target.value })} data-testid="vendor-tagline" /></div>
        <div className="field-row">
          <div className="field">
            <div className="field-label">Discount % *</div>
            <input type="number" min={0} max={80} className="field-input" value={v.discount_pct} onChange={(e) => setV({ ...v, discount_pct: Number(e.target.value) })} data-testid="vendor-discount" />
          </div>
          <div className="field">
            <div className="field-label">Star Rating</div>
            <input type="number" step={0.5} min={1} max={5} className="field-input" value={v.star_rating || ""} onChange={(e) => setV({ ...v, star_rating: Number(e.target.value) || null })} />
          </div>
        </div>
        <div className="field"><div className="field-label">Image URL</div>
          <input className="field-input" value={v.image_url || ""} onChange={(e) => setV({ ...v, image_url: e.target.value })} placeholder="https://…" /></div>
        <div className="field-row">
          <div className="field"><div className="field-label">Partner URL</div>
            <input className="field-input" value={v.partner_url || ""} onChange={(e) => setV({ ...v, partner_url: e.target.value })} placeholder="https://…" /></div>
          <div className="field"><div className="field-label">CTA Label</div>
            <input className="field-input" value={v.cta_label} onChange={(e) => setV({ ...v, cta_label: e.target.value })} placeholder="Get Quote" /></div>
        </div>
        <div className="field-row">
          <div className="field"><div className="field-label">Contact email</div>
            <input className="field-input" value={v.contact_email || ""} onChange={(e) => setV({ ...v, contact_email: e.target.value })} /></div>
          <div className="field"><div className="field-label">Phone</div>
            <input className="field-input" value={v.phone || ""} onChange={(e) => setV({ ...v, phone: e.target.value })} /></div>
        </div>
        <div className="flex gap-16 mb-16">
          <label className="flex items-center gap-8"><input type="checkbox" checked={!!v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} data-testid="vendor-active" /> <span>Active</span></label>
          <label className="flex items-center gap-8"><input type="checkbox" checked={!!v.is_featured} onChange={(e) => setV({ ...v, is_featured: e.target.checked })} data-testid="vendor-featured" /> <span>Featured</span></label>
        </div>
        <div className="flex gap-12">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" disabled={!v.name} onClick={() => onSave(v)} data-testid="vendor-save" style={{ flex: 1 }}>Save Vendor</button>
        </div>
      </div>
    </div>
  );
}
