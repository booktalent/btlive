import React, { useEffect, useState } from "react";
import api, { fmtINRFull } from "../../lib/api";

/* ─────────────────────────────────────────────────────────────────
   Master Data — Categories / Cities / Event Types / Languages
   ───────────────────────────────────────────────────────────────── */
export function AdminMaster({ toast }) {
  const [entity, setEntity] = useState("categories");
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", icon: "", sort_order: 0, active: true });
  const [editing, setEditing] = useState(null);

  const load = () => api.get(`/admin/master/${entity}`).then((r) => setList(r.data));
  // `load` is redefined every render; including it would infinite-loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [entity]);

  const save = async () => {
    if (!form.name.trim()) return toast("Name is required");
    if (editing) {
      await api.put(`/admin/master/${entity}/${editing}`, form);
      toast("Updated");
    } else {
      await api.post(`/admin/master/${entity}`, form);
      toast("Added");
    }
    setForm({ name: "", icon: "", sort_order: 0, active: true });
    setEditing(null);
    load();
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    await api.delete(`/admin/master/${entity}/${id}`);
    toast("Deleted");
    load();
  };

  const edit = (item) => { setEditing(item.id); setForm({ name: item.name, icon: item.icon || "", sort_order: item.sort_order || 0, active: !!item.active }); };

  return (
    <div className="card" data-testid="admin-master">
      <div className="card-head" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <div className="card-title">🗂️ Master Data</div>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="input" style={{ width: 200 }} data-testid="master-entity-select">
          <option value="categories">Categories</option>
          <option value="cities">Cities</option>
          <option value="event-types">Event Types</option>
          <option value="languages">Languages</option>
        </select>
      </div>
      <div style={{ padding: 14 }}>
        <div className="grid grid-4 gap-12" style={{ marginBottom: 14 }}>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="master-name" />
          <input className="input" placeholder="Icon (emoji)" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} data-testid="master-icon" />
          <input className="input" type="number" placeholder="Sort order" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} data-testid="master-sort" />
          <button className="btn btn-gold" onClick={save} data-testid="master-save">{editing ? "Update" : "+ Add"}</button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Slug</th><th>Icon</th><th>Order</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} data-testid={`master-row-${m.id}`}>
                  <td className="fw-600">{m.name}</td>
                  <td className="text-muted fs-12">{m.slug}</td>
                  <td>{m.icon || "—"}</td>
                  <td>{m.sort_order}</td>
                  <td>{m.active ? <span className="pill pill-green">Yes</span> : <span className="pill pill-amber">No</span>}</td>
                  <td>
                    <button className="btn btn-ghost btn-xs" onClick={() => edit(m)} data-testid={`master-edit-${m.id}`}>Edit</button>
                    <button className="btn btn-red btn-xs" onClick={() => remove(m.id)} style={{ marginLeft: 6 }} data-testid={`master-del-${m.id}`}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Boost Packages Manager
   ───────────────────────────────────────────────────────────────── */
export function AdminBoost({ toast }) {
  const [tab, setTab] = useState("packages");
  const [packages, setPackages] = useState([]);
  const [subs, setSubs] = useState([]);
  const [form, setForm] = useState({
    name: "", type: "featured_artist", duration_days: 30, price: 1999,
    gst_pct: 18, commission_pct: 0, description: "", active: true,
  });
  const [editing, setEditing] = useState(null);

  const loadPkgs = () => api.get("/admin/boost/packages").then((r) => setPackages(r.data));
  const loadSubs = () => api.get("/admin/boost/subscriptions").then((r) => setSubs(r.data));

  useEffect(() => { loadPkgs(); loadSubs(); }, []);

  const save = async () => {
    if (!form.name.trim()) return toast("Name required");
    if (editing) {
      await api.put(`/admin/boost/packages/${editing}`, form);
      toast("Package updated");
    } else {
      await api.post("/admin/boost/packages", form);
      toast("Package created");
    }
    setForm({ name: "", type: "featured_artist", duration_days: 30, price: 1999, gst_pct: 18, commission_pct: 0, description: "", active: true });
    setEditing(null);
    loadPkgs();
  };

  const edit = (p) => { setEditing(p.id); setForm({ name: p.name, type: p.type, duration_days: p.duration_days, price: p.price, gst_pct: p.gst_pct, commission_pct: p.commission_pct, description: p.description, active: p.active }); };
  const remove = async (id) => { if (!window.confirm("Delete?")) return; await api.delete(`/admin/boost/packages/${id}`); toast("Deleted"); loadPkgs(); };
  const cancelSub = async (id) => { await api.post(`/admin/boost/${id}/cancel`); toast("Cancelled"); loadSubs(); };

  return (
    <div className="card" data-testid="admin-boost">
      <div className="card-head">
        <div className="card-title">🚀 Boost / Promotion Manager</div>
      </div>
      <div className="flex gap-12" style={{ padding: "12px 14px 0" }}>
        <button className={`btn btn-xs ${tab === "packages" ? "btn-gold" : "btn-ghost"}`} onClick={() => setTab("packages")} data-testid="boost-tab-packages">Packages ({packages.length})</button>
        <button className={`btn btn-xs ${tab === "subs" ? "btn-gold" : "btn-ghost"}`} onClick={() => setTab("subs")} data-testid="boost-tab-subs">Active Subscribers ({subs.filter((s) => s.status === "active").length})</button>
      </div>

      {tab === "packages" && (
        <div style={{ padding: 14 }}>
          <div className="grid grid-4 gap-12" style={{ marginBottom: 14 }}>
            <input className="input" placeholder="Package name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="boost-pkg-name" />
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} data-testid="boost-pkg-type">
              {["featured_artist", "homepage_banner", "category_top", "search_priority", "premium_badge", "verified_badge", "city_featured", "trending", "recommended"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="input" type="number" placeholder="Days" value={form.duration_days} onChange={(e) => setForm({ ...form, duration_days: parseInt(e.target.value) || 0 })} data-testid="boost-pkg-days" />
            <input className="input" type="number" placeholder="Price ₹" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} data-testid="boost-pkg-price" />
            <input className="input" type="number" placeholder="GST %" value={form.gst_pct} onChange={(e) => setForm({ ...form, gst_pct: parseFloat(e.target.value) || 0 })} />
            <input className="input" type="number" placeholder="Commission %" value={form.commission_pct} onChange={(e) => setForm({ ...form, commission_pct: parseFloat(e.target.value) || 0 })} />
            <input className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button className="btn btn-gold" onClick={save} data-testid="boost-pkg-save">{editing ? "Update" : "+ Add Package"}</button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Type</th><th>Days</th><th>Price</th><th>GST</th><th>Active</th><th>Actions</th></tr></thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} data-testid={`boost-pkg-row-${p.id}`}>
                    <td className="fw-600">{p.name}</td>
                    <td><span className="pill pill-purple">{p.type}</span></td>
                    <td>{p.duration_days}d</td>
                    <td className="text-gold font-serif fw-700">{fmtINRFull(p.price)}</td>
                    <td>{p.gst_pct}%</td>
                    <td>{p.active ? <span className="pill pill-green">Yes</span> : <span className="pill pill-amber">No</span>}</td>
                    <td>
                      <button className="btn btn-ghost btn-xs" onClick={() => edit(p)} data-testid={`boost-edit-${p.id}`}>Edit</button>
                      <button className="btn btn-red btn-xs" onClick={() => remove(p.id)} style={{ marginLeft: 6 }} data-testid={`boost-del-${p.id}`}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "subs" && (
        <div style={{ padding: 14 }}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Artist</th><th>Package</th><th>Type</th><th>Paid</th><th>Status</th><th>Expires</th><th>Actions</th></tr></thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} data-testid={`boost-sub-${s.id}`}>
                    <td>{s.artist?.name || s.artist_id?.slice(0, 8)}</td>
                    <td>{s.package_snapshot?.name}</td>
                    <td><span className="pill pill-purple">{s.type}</span></td>
                    <td className="text-gold">{fmtINRFull(s.total)}</td>
                    <td><span className={`pill ${s.status === "active" ? "pill-green" : "pill-amber"}`}>{s.status}</span></td>
                    <td className="fs-12 text-muted">{s.expires_at?.slice(0, 10)}</td>
                    <td>{s.status === "active" && <button className="btn btn-red btn-xs" onClick={() => cancelSub(s.id)} data-testid={`boost-cancel-${s.id}`}>Cancel</button>}</td>
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

/* ─────────────────────────────────────────────────────────────────
   Templates editor (email / sms / whatsapp / push / in_app)
   ───────────────────────────────────────────────────────────────── */
export function AdminTemplates({ toast }) {
  const [channel, setChannel] = useState("email");
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ channel: "email", code: "", subject: "", body: "", active: true });

  const load = () => api.get(`/admin/templates?channel=${channel}`).then((r) => setList(r.data));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); setForm({ ...form, channel }); }, [channel]);

  const save = async () => {
    if (!form.code.trim() || !form.body.trim()) return toast("Code & body required");
    await api.post("/admin/templates", form);
    toast("Saved");
    setForm({ channel, code: "", subject: "", body: "", active: true });
    load();
  };

  const edit = (t) => setForm({ channel: t.channel, code: t.code, subject: t.subject || "", body: t.body, active: t.active });
  const remove = async (id) => { await api.delete(`/admin/templates/${id}`); toast("Deleted"); load(); };

  return (
    <div className="card" data-testid="admin-templates">
      <div className="card-head" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <div className="card-title">📧 Notification Templates</div>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input" style={{ width: 180 }} data-testid="tpl-channel">
          {["email", "in_app", "sms", "whatsapp", "push"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{ padding: 14 }}>
        <div className="grid grid-2 gap-12" style={{ marginBottom: 14 }}>
          <input className="input" placeholder="Event code (e.g. booking.confirmed)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="tpl-code" />
          <input className="input" placeholder="Subject / Title" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="tpl-subject" />
        </div>
        <textarea className="input" placeholder="Body — use {variable} tokens. e.g. Hi {customer_name}, your booking {ref} is confirmed for {event_date}." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} style={{ marginBottom: 12, width: "100%" }} data-testid="tpl-body" />
        <button className="btn btn-gold" onClick={save} data-testid="tpl-save">Save Template</button>

        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="table">
            <thead><tr><th>Code</th><th>Subject</th><th>Body Preview</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} data-testid={`tpl-row-${t.id}`}>
                  <td className="font-mono fs-12">{t.code}</td>
                  <td>{t.subject || "—"}</td>
                  <td className="fs-12" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }}>{t.body}</td>
                  <td>{t.active ? <span className="pill pill-green">Yes</span> : <span className="pill pill-amber">No</span>}</td>
                  <td>
                    <button className="btn btn-ghost btn-xs" onClick={() => edit(t)} data-testid={`tpl-edit-${t.id}`}>Edit</button>
                    <button className="btn btn-red btn-xs" onClick={() => remove(t.id)} style={{ marginLeft: 6 }} data-testid={`tpl-del-${t.id}`}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FAQs / CMS / Broadcast / Settings / Audit / Reports
   ───────────────────────────────────────────────────────────────── */
export function AdminFAQs({ toast }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ question: "", answer: "", category: "general", sort_order: 0, active: true });
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/admin/faqs").then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.question.trim()) return toast("Question required");
    if (editing) await api.put(`/admin/faqs/${editing}`, form); else await api.post("/admin/faqs", form);
    toast("Saved"); setEditing(null); setForm({ question: "", answer: "", category: "general", sort_order: 0, active: true }); load();
  };
  const edit = (f) => { setEditing(f.id); setForm({ question: f.question, answer: f.answer, category: f.category, sort_order: f.sort_order, active: f.active }); };
  const del = async (id) => { await api.delete(`/admin/faqs/${id}`); toast("Deleted"); load(); };
  return (
    <div className="card" data-testid="admin-faqs">
      <div className="card-head"><div className="card-title">❓ FAQs ({list.length})</div></div>
      <div style={{ padding: 14 }}>
        <input className="input mb-8" placeholder="Question" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} data-testid="faq-q" style={{ width: "100%", marginBottom: 8 }} />
        <textarea className="input mb-8" placeholder="Answer" value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} rows={3} data-testid="faq-a" style={{ width: "100%", marginBottom: 8 }} />
        <div className="flex gap-12" style={{ marginBottom: 12 }}>
          <input className="input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input" type="number" placeholder="Sort" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} />
          <button className="btn btn-gold" onClick={save} data-testid="faq-save">{editing ? "Update" : "+ Add"}</button>
        </div>
        {list.map((f) => (
          <div key={f.id} className="card card-pad mb-12" data-testid={`faq-row-${f.id}`}>
            <div className="fw-600">{f.question}</div>
            <div className="text-muted fs-13 mt-4">{f.answer}</div>
            <div className="mt-8 flex gap-8">
              <span className="pill pill-purple">{f.category}</span>
              <button className="btn btn-ghost btn-xs" onClick={() => edit(f)}>Edit</button>
              <button className="btn btn-red btn-xs" onClick={() => del(f.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminCMS({ toast }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ slug: "", title: "", body_html: "", meta_description: "", published: true });
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/admin/cms").then((r) => setList(r.data));
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.slug || !form.title) return toast("Slug & title required");
    if (editing) await api.put(`/admin/cms/${editing}`, form); else await api.post("/admin/cms", form);
    toast("Saved"); setEditing(null); setForm({ slug: "", title: "", body_html: "", meta_description: "", published: true }); load();
  };
  const edit = (p) => { setEditing(p.id); setForm({ slug: p.slug, title: p.title, body_html: p.body_html, meta_description: p.meta_description || "", published: p.published }); };
  const del = async (id) => { await api.delete(`/admin/cms/${id}`); toast("Deleted"); load(); };
  return (
    <div className="card" data-testid="admin-cms">
      <div className="card-head"><div className="card-title">📄 CMS Pages</div></div>
      <div style={{ padding: 14 }}>
        <div className="grid grid-2 gap-12" style={{ marginBottom: 8 }}>
          <input className="input" placeholder="Slug (e.g. about, terms)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} data-testid="cms-slug" />
          <input className="input" placeholder="Page Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="cms-title" />
        </div>
        <textarea className="input" placeholder="HTML body" rows={6} value={form.body_html} onChange={(e) => setForm({ ...form, body_html: e.target.value })} data-testid="cms-body" style={{ width: "100%", marginBottom: 8 }} />
        <input className="input" placeholder="Meta description" value={form.meta_description} onChange={(e) => setForm({ ...form, meta_description: e.target.value })} style={{ width: "100%", marginBottom: 12 }} />
        <button className="btn btn-gold" onClick={save} data-testid="cms-save">{editing ? "Update" : "+ Add Page"}</button>
        <div className="table-wrap" style={{ marginTop: 18 }}>
          <table className="table">
            <thead><tr><th>Slug</th><th>Title</th><th>Published</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} data-testid={`cms-row-${p.id}`}>
                  <td className="font-mono fs-12">{p.slug}</td>
                  <td>{p.title}</td>
                  <td>{p.published ? <span className="pill pill-green">Yes</span> : <span className="pill pill-amber">No</span>}</td>
                  <td>
                    <button className="btn btn-ghost btn-xs" onClick={() => edit(p)}>Edit</button>
                    <button className="btn btn-red btn-xs" onClick={() => del(p.id)} style={{ marginLeft: 6 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AdminBroadcast({ toast }) {
  const [log, setLog] = useState([]);
  const [form, setForm] = useState({ audience: "artist", event: "platform.announcement", channels: ["in_app"], title: "", body: "" });
  const loadLog = () => api.get("/admin/notifications/log?limit=50").then((r) => setLog(r.data));
  useEffect(() => { loadLog(); }, []);
  const send = async () => {
    if (!form.title || !form.body) return toast("Title & body required");
    const r = await api.post("/admin/notifications/broadcast", form);
    toast(`Delivered to ${r.data.delivered} users`);
    setForm({ ...form, title: "", body: "" });
    loadLog();
  };
  const toggle = (ch) => setForm({ ...form, channels: form.channels.includes(ch) ? form.channels.filter((c) => c !== ch) : [...form.channels, ch] });
  return (
    <div className="card" data-testid="admin-broadcast">
      <div className="card-head"><div className="card-title">📢 Broadcast Notification</div></div>
      <div style={{ padding: 14 }}>
        <div className="grid grid-2 gap-12" style={{ marginBottom: 8 }}>
          <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} data-testid="bc-audience">
            {["all", "artist", "customer", "agency", "corporate", "admin"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input className="input" placeholder="Event code (e.g. platform.announcement)" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} data-testid="bc-event" />
        </div>
        <input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ width: "100%", marginBottom: 8 }} data-testid="bc-title" />
        <textarea className="input" placeholder="Body" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ width: "100%", marginBottom: 12 }} data-testid="bc-body" />
        <div className="flex gap-8" style={{ marginBottom: 12 }}>
          {["in_app", "email", "sms", "whatsapp", "push"].map((c) => (
            <button key={c} className={`btn btn-xs ${form.channels.includes(c) ? "btn-gold" : "btn-ghost"}`} onClick={() => toggle(c)} data-testid={`bc-ch-${c}`}>{c}</button>
          ))}
        </div>
        <button className="btn btn-gold" onClick={send} data-testid="bc-send">Send Broadcast</button>

        <h4 className="font-serif mt-24 fs-16 fw-700" style={{ marginTop: 24, marginBottom: 8 }}>Recent Notification Log</h4>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Event</th><th>Channel</th><th>Subject</th><th>Status</th><th>Mode</th></tr></thead>
            <tbody>
              {log.slice(0, 20).map((l) => (
                <tr key={l.id} data-testid={`bc-log-${l.id}`}>
                  <td className="fs-11 text-muted">{l.created_at?.slice(0, 19).replace("T", " ")}</td>
                  <td className="font-mono fs-11">{l.event}</td>
                  <td><span className="pill pill-purple">{l.channel}</span></td>
                  <td className="fs-12">{l.subject}</td>
                  <td><span className={`pill ${l.status === "sent" ? "pill-green" : "pill-amber"}`}>{l.status}</span></td>
                  <td className="fs-11">{l.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AdminSettings({ toast }) {
  const [list, setList] = useState([]);
  const [draft, setDraft] = useState({});
  const load = () => api.get("/admin/settings").then((r) => { setList(r.data); setDraft({}); });
  useEffect(() => { load(); }, []);
  const save = async (key) => {
    if (!(key in draft)) return;
    let value = draft[key];
    if (!isNaN(parseFloat(value)) && isFinite(value)) value = parseFloat(value);
    await api.put(`/admin/settings/${key}`, { value });
    toast("Saved"); load();
  };
  return (
    <div className="card" data-testid="admin-settings">
      <div className="card-head"><div className="card-title">⚙️ System Settings</div></div>
      <div style={{ padding: 14 }}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Key</th><th>Current Value</th><th>New Value</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.key} data-testid={`set-row-${s.key}`}>
                  <td className="font-mono fs-12">{s.key}</td>
                  <td className="text-gold">{String(s.value)}</td>
                  <td><input className="input" defaultValue={s.value} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })} data-testid={`set-input-${s.key}`} /></td>
                  <td><button className="btn btn-gold btn-xs" onClick={() => save(s.key)} data-testid={`set-save-${s.key}`}>Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AdminAudit() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/admin/audit-logs?limit=200").then((r) => setList(r.data)); }, []);
  return (
    <div className="card" data-testid="admin-audit">
      <div className="card-head"><div className="card-title">🛡️ Audit Logs ({list.length})</div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Target ID</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} data-testid={`audit-${a.id}`}>
                <td className="fs-11 text-muted">{a.created_at?.slice(0, 19).replace("T", " ")}</td>
                <td className="fs-12">{a.actor_email || a.actor_id?.slice(0, 8)}</td>
                <td className="font-mono fs-12">{a.action}</td>
                <td>{a.target_type}</td>
                <td className="fs-11 text-muted">{a.target_id?.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminReports() {
  const [days, setDays] = useState(30);
  const [revenue, setRevenue] = useState(null);
  const [top, setTop] = useState([]);
  const load = () => {
    api.get(`/admin/reports/revenue?days=${days}`).then((r) => setRevenue(r.data));
    api.get(`/admin/reports/top-artists?limit=10`).then((r) => setTop(r.data));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [days]);
  return (
    <div className="card" data-testid="admin-reports">
      <div className="card-head" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <div className="card-title">📈 Reports & Analytics</div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value))} className="input" style={{ width: 160 }} data-testid="rep-days">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>
      <div style={{ padding: 14 }}>
        {revenue && (
          <div className="kpi-grid mb-24">
            <div className="kpi"><div className="kpi-num text-gold">{fmtINRFull(revenue.gmv)}</div><div className="kpi-label">Marketplace GMV<br/><span className="fs-10 text-muted">(artist fees — informational)</span></div></div>
            <div className="kpi"><div className="kpi-num text-gold">{fmtINRFull(revenue.platform_revenue)}</div><div className="kpi-label">Platform Service Revenue<br/><span className="fs-10 text-muted">(BookTalent net earnings)</span></div></div>
            <div className="kpi"><div className="kpi-num text-gold">{fmtINRFull(revenue.gst_collected || 0)}</div><div className="kpi-label">GST Collected</div></div>
            <div className="kpi"><div className="kpi-num text-gold">{fmtINRFull(revenue.boost_revenue)}</div><div className="kpi-label">Boost Revenue</div></div>
            <div className="kpi"><div className="kpi-num text-gold">{fmtINRFull(revenue.net_revenue || (revenue.platform_revenue + revenue.boost_revenue))}</div><div className="kpi-label">Net BookTalent Revenue</div></div>
            <div className="kpi"><div className="kpi-num">{revenue.bookings}</div><div className="kpi-label">Bookings</div></div>
          </div>
        )}
        <h4 className="font-serif fs-16 fw-700" style={{ marginBottom: 12 }}>Top Artists by Revenue</h4>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Artist</th><th>Category</th><th>City</th><th>Bookings</th><th>Revenue</th></tr></thead>
            <tbody>
              {top.map((t, i) => (
                <tr key={t.artist_id} data-testid={`rep-artist-${t.artist_id}`}>
                  <td className="fw-700">{i + 1}</td>
                  <td>{t.stage_name}</td>
                  <td>{t.category}</td>
                  <td>{t.city}</td>
                  <td>{t.bookings}</td>
                  <td className="text-gold font-serif fw-700">{fmtINRFull(t.revenue || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Reviews Moderation
   ───────────────────────────────────────────────────────────────── */
export function AdminReviewsModeration({ toast }) {
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState([]);
  const load = () => api.get(`/admin/reviews?status=${status}`).then((r) => setList(r.data));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [status]);

  const decide = async (rid, decision) => {
    let reason = "";
    if (decision === "reject") {
      reason = window.prompt("Reason for rejection (will be sent to customer):", "") || "";
      if (!reason.trim()) { toast("Reason required", "error"); return; }
    }
    try {
      await api.post(`/admin/reviews/${rid}/moderate`, { decision, reason });
      toast(`Review ${decision === "approve" ? "approved" : "rejected"}`);
      load();
    } catch (e) { toast(e?.response?.data?.detail || "Failed", "error"); }
  };

  const pendingCount = list.length;

  return (
    <div className="card" data-testid="admin-reviews-mod">
      <div className="card-head" style={{ justifyContent: "space-between", display: "flex", alignItems: "center" }}>
        <div className="card-title">🛡️ Reviews Moderation ({pendingCount})</div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input" style={{ width: 200 }} data-testid="review-status-filter">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      <div style={{ padding: 14 }}>
        {list.length === 0 && <div className="empty"><div className="empty-icon">🛡️</div><div className="empty-title">No reviews to moderate</div></div>}
        {list.map((r) => (
          <div key={r.id} className="card card-pad mb-12" style={{ marginBottom: 12 }} data-testid={`review-${r.id}`}>
            <div className="flex items-center" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="fw-700">★ {r.rating} — {r.customer_name}</div>
                <div className="text-muted fs-12">Artist: {r.artist_stage_name || r.artist_id?.slice(0, 8)} · {r.created_at?.slice(0, 10)} · <span className={`pill pill-${r.moderated === "approved" ? "green" : r.moderated === "rejected" ? "red" : "amber"}`}>{r.moderated}</span></div>
              </div>
              {r.moderated === "pending" && (
                <div className="flex gap-8">
                  <button className="btn btn-green btn-sm" onClick={() => decide(r.id, "approve")} data-testid={`approve-rv-${r.id}`}>✓ Approve</button>
                  <button className="btn btn-red btn-sm" onClick={() => decide(r.id, "reject")} data-testid={`reject-rv-${r.id}`}>✕ Reject</button>
                </div>
              )}
            </div>
            <div className="mt-8 fs-13" style={{ marginTop: 8 }}>{r.text}</div>
            {(r.photos?.length > 0 || r.videos?.length > 0) && (
              <div className="grid grid-4 gap-12 mt-12" style={{ marginTop: 12 }}>
                {(r.photos || []).map((mid) => (
                  <a key={mid} href={`${api.defaults.baseURL}/media/${mid}`} target="_blank" rel="noreferrer">
                    <img src={`${api.defaults.baseURL}/media/${mid}/thumb`} alt="" style={{ width: "100%", borderRadius: 8 }} />
                  </a>
                ))}
                {(r.videos || []).map((mid) => (
                  <video key={mid} src={`${api.defaults.baseURL}/media/${mid}`} controls style={{ width: "100%", borderRadius: 8 }} />
                ))}
              </div>
            )}
            {r.moderation_reason && <div className="text-muted fs-12 mt-8" style={{ marginTop: 8 }}>Reason: {r.moderation_reason}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Providers — status + test hooks
   ───────────────────────────────────────────────────────────────── */
export function AdminProviders({ toast }) {
  const [status, setStatus] = useState(null);
  const [test, setTest] = useState({ provider: "sms", to: "", message: "BookTalent test ping" });
  const [result, setResult] = useState(null);

  const load = () => api.get("/admin/providers/status").then((r) => setStatus(r.data));
  useEffect(() => { load(); }, []);

  const send = async () => {
    if (!test.to.trim()) return toast("Recipient required", "error");
    try {
      const r = await api.post(`/admin/providers/test/${test.provider}`, { to: test.to, message: test.message });
      setResult(r.data);
      toast(r.data.status === "sent" ? "✓ Sent live" : r.data.status === "mocked" ? "Mock (no keys set)" : "Failed");
    } catch (e) { toast(e?.response?.data?.detail || "Failed", "error"); }
  };

  const providers = status ? [
    { key: "email_resend", label: "📧 Email (Resend)", info: "RESEND_API_KEY" },
    { key: "sms_twilio", label: "📱 SMS (Twilio)", info: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM" },
    { key: "whatsapp_gupshup", label: "💬 WhatsApp (Gupshup/Meta)", info: "WHATSAPP_TOKEN, WHATSAPP_FROM" },
    { key: "push_fcm", label: "🔔 Push (FCM)", info: "FCM_SERVER_KEY" },
    { key: "razorpay", label: "💳 Payments (Razorpay)", info: "RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET" },
    { key: "stripe", label: "💳 Payments (Stripe)", info: "STRIPE_SECRET_KEY" },
  ] : [];

  return (
    <div className="card" data-testid="admin-providers">
      <div className="card-head"><div className="card-title">🔌 Provider Integrations</div></div>
      <div style={{ padding: 14 }}>
        <p className="text-muted fs-13 mb-12">Each provider auto-activates when its environment variables are present in <code>/app/backend/.env</code>. No code change required.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Provider</th><th>Status</th><th>Required ENV Keys</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.key} data-testid={`prov-${p.key}`}>
                  <td className="fw-700">{p.label}</td>
                  <td>{status[p.key].live
                    ? <span className="pill pill-green" data-testid={`prov-${p.key}-status`}>● Live</span>
                    : <span className="pill pill-amber" data-testid={`prov-${p.key}-status`}>○ Mock (no key)</span>}</td>
                  <td className="text-muted fs-11">{p.info}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="font-serif mt-24 fs-16 fw-700" style={{ marginTop: 24, marginBottom: 8 }}>Send Test Message</h4>
        <div className="grid grid-3 gap-12" style={{ marginBottom: 12 }}>
          <select className="input" value={test.provider} onChange={(e) => setTest({ ...test, provider: e.target.value })} data-testid="prov-test-channel">
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="push">Push</option>
          </select>
          <input className="input" placeholder={test.provider === "push" ? "FCM token" : "+91xxxxxxxxxx"} value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} data-testid="prov-test-to" />
          <input className="input" placeholder="Message" value={test.message} onChange={(e) => setTest({ ...test, message: e.target.value })} data-testid="prov-test-msg" />
        </div>
        <button className="btn btn-gold" onClick={send} data-testid="prov-test-send">Send Test</button>
        {result && (
          <pre className="card card-pad mt-12 fs-12" style={{ marginTop: 12, background: "var(--glass)" }}>{JSON.stringify(result, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

