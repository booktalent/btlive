import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Nav from "../components/Nav";
import api, { formatApiError } from "../lib/api";

const TYPE_ICON = { hotel: "🏨", flight: "✈️", transport: "🚗" };
const TYPES = [
  { code: "", label: "All Partners" },
  { code: "hotel", label: "Hotels" },
  { code: "flight", label: "Flights" },
  { code: "transport", label: "Transport" },
];

/**
 * Public Partners Directory — SEO-friendly landing pages capturing organic
 * traffic from customers researching hotels / flights for their events.
 */
export function Partners({ toast }) {
  const [items, setItems] = useState([]);
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ limit: "60" });
    if (type) p.set("type", type);
    if (city) p.set("city", city);
    api.get(`/rider-wallet/vendors?${p.toString()}`)
      .then((r) => setItems(r.data || []))
      .catch((e) => toast?.(formatApiError(e), "error"))
      .finally(() => setLoading(false));
  }, [type, city, toast]);

  // Basic SEO — document title
  useEffect(() => {
    document.title = "Trusted Event Partners — BookTalent";
    return () => { document.title = "BookTalent"; };
  }, []);

  return (
    <div>
      <Nav />
      <div className="hero-band" style={{ padding: "60px 0 32px" }}>
        <div className="container">
          <div className="text-center">
            <div className="badge-pill" data-testid="partners-pill">💼 Trusted Partners</div>
            <h1 className="hero-title" style={{ fontSize: "clamp(32px, 5vw, 56px)", marginTop: 12 }}>
              Handpicked <span className="gold-grad">Hotels · Flights · Transport</span>
            </h1>
            <p className="hero-sub" style={{ maxWidth: 640, margin: "16px auto" }}>
              Every partner offers BookTalent-negotiated group rates for artist teams. Contact them directly, mention BookTalent, save up to 30%.
            </p>
          </div>
        </div>
      </div>

      <section className="container">
        <div className="flex gap-8 mb-24 items-center" style={{ flexWrap: "wrap" }}>
          {TYPES.map((t) => (
            <button
              key={t.code || "all"}
              onClick={() => setType(t.code)}
              className={`btn btn-sm ${type === t.code ? "btn-gold" : "btn-ghost"}`}
              data-testid={`partners-tab-${t.code || "all"}`}
            >
              {t.code && TYPE_ICON[t.code]} {t.label}
            </button>
          ))}
          <input
            className="field-input"
            style={{ maxWidth: 220, marginLeft: "auto" }}
            placeholder="Filter by city…"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            data-testid="partners-city-filter"
          />
        </div>

        {loading ? (
          <div className="grid grid-3">
            {[...Array(6)].map((_, i) => <div key={`sk-${i}`} className="skeleton" style={{ height: 260 }} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="empty"><div className="empty-icon">💼</div><div className="empty-title">No partners match your filter</div></div>
        ) : (
          <div className="grid grid-3">
            {items.map((v) => (
              <Link
                to={`/partners/${v.slug}`}
                key={v.id}
                className="artist-card"
                data-testid={`partner-card-${v.slug}`}
                style={{ textDecoration: "none" }}
              >
                <div
                  className="artist-card-cover"
                  style={{
                    backgroundImage: v.image_url ? `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.6) 100%), url('${v.image_url}')` : undefined,
                    backgroundColor: "rgba(212,175,55,0.08)",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  <span className="boost-tag" style={{ background: v.type === "hotel" ? "linear-gradient(135deg,#f472b6,#d4af37)" : v.type === "flight" ? "linear-gradient(135deg,#60a5fa,#7c3aed)" : "linear-gradient(135deg,#34d399,#059669)" }}>
                    {TYPE_ICON[v.type]} {v.type.toUpperCase()}
                  </span>
                  {v.is_featured && <span className="boost-tag" style={{ top: 30 }}>★ FEATURED</span>}
                </div>
                <div className="artist-card-body">
                  <div className="artist-card-name">{v.name}</div>
                  <div className="artist-card-meta">{v.tagline}</div>
                  <div className="artist-card-foot">
                    <span className="artist-card-rating">📍 {v.city || "Nationwide"}</span>
                    <span className="artist-card-price text-gold">{v.discount_pct}%<small> off</small></span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * SEO-friendly partner detail — /partners/taj-group-hotel
 * Fully public, no auth. Includes related-partners rail for internal linking.
 */
export function PartnerDetail() {
  const { slug } = useParams();
  const [vendor, setVendor] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/partners/${slug}`)
      .then((r) => { setVendor(r.data.vendor); setRelated(r.data.related || []); })
      .catch((e) => setError(e.response?.status === 404 ? "not_found" : "error"))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (vendor) {
      document.title = `${vendor.name} — Trusted BookTalent Partner`;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", `${vendor.tagline} — Save ${vendor.discount_pct}% on ${vendor.type} with BookTalent's exclusive partner rate.`);
    }
    return () => { document.title = "BookTalent"; };
  }, [vendor]);

  const trackClick = (v) => {
    // Fire-and-forget click beacon — feeds the admin leaderboard
    api.post(`/rider-wallet/vendors/${v.id}/click`).catch(() => {});
  };

  if (loading) return (<div><Nav /><div className="container" style={{ padding: 40 }}><div className="skeleton" style={{ height: 500 }} /></div></div>);
  if (error === "not_found") return (
    <div><Nav />
      <div className="container text-center" style={{ padding: 80 }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>🔍</div>
        <h1 className="font-serif fs-32 fw-700">Partner not found</h1>
        <p className="text-muted mb-24">This partner may have been removed or the URL is incorrect.</p>
        <Link to="/partners" className="btn btn-gold">← All Partners</Link>
      </div>
    </div>
  );
  if (!vendor) return null;

  return (
    <div data-testid="partner-detail-page">
      <Nav />
      <div className="hero-band" style={{
        padding: "60px 0 40px",
        backgroundImage: vendor.image_url ? `linear-gradient(180deg, rgba(11,6,22,0.75), rgba(11,6,22,0.95)), url('${vendor.image_url}')` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}>
        <div className="container">
          <Link to="/partners" className="text-muted fs-13" data-testid="partner-back">← Back to all partners</Link>
          <div className="flex justify-between items-start mt-16" style={{ flexWrap: "wrap", gap: 24 }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="badge-pill" style={{ background: "rgba(212,175,55,0.15)" }}>{TYPE_ICON[vendor.type]} {vendor.type.toUpperCase()}</div>
              <h1 className="hero-title" style={{ fontSize: "clamp(32px, 5vw, 56px)", marginTop: 12 }} data-testid="partner-name">
                <span className="gold-grad">{vendor.name}</span>
              </h1>
              <p className="hero-sub" style={{ maxWidth: 600, marginTop: 12 }}>{vendor.tagline}</p>
              <div className="flex gap-16 mt-16" style={{ flexWrap: "wrap" }}>
                <div><div className="text-muted fs-11">Coverage</div><div className="fw-700">📍 {vendor.city || "Nationwide"}</div></div>
                <div><div className="text-muted fs-11">Discount</div><div className="fw-700 text-gold">{vendor.discount_pct}% off</div></div>
                {vendor.star_rating && (<div><div className="text-muted fs-11">Rating</div><div className="fw-700">{"★".repeat(Math.floor(vendor.star_rating))}</div></div>)}
                {vendor.click_count > 0 && (<div><div className="text-muted fs-11">Popularity</div><div className="fw-700">{vendor.click_count} requests</div></div>)}
              </div>
            </div>
            <div className="card card-pad" style={{ minWidth: 280, maxWidth: 360, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.3)" }}>
              <div className="text-muted fs-11" style={{ textTransform: "uppercase", letterSpacing: 1 }}>💰 Partner Rate</div>
              <div className="fw-700 font-serif" style={{ fontSize: 36, color: "var(--gold)", margin: "8px 0" }}>{vendor.discount_pct}% off</div>
              <p className="text-muted fs-12 mb-16">Mention BookTalent when you reach out.</p>
              {vendor.partner_url ? (
                <a href={vendor.partner_url} target="_blank" rel="noopener noreferrer" className="btn btn-gold btn-block" onClick={() => trackClick(vendor)} data-testid="partner-primary-cta">{vendor.cta_label || "Visit Partner"} →</a>
              ) : vendor.contact_email ? (
                <a href={`mailto:${vendor.contact_email}?subject=BookTalent partner inquiry`} className="btn btn-gold btn-block" onClick={() => trackClick(vendor)} data-testid="partner-primary-cta">Email {vendor.contact_email}</a>
              ) : null}
              {vendor.phone && (
                <a href={`tel:${vendor.phone}`} className="btn btn-ghost btn-block mt-8" onClick={() => trackClick(vendor)}>Call {vendor.phone}</a>
              )}
            </div>
          </div>
        </div>
      </div>

      {vendor.description && (
        <section className="container" style={{ paddingTop: 32 }}>
          <div className="card card-pad" style={{ maxWidth: 720, marginInline: "auto" }}>
            <h2 className="fs-20 fw-700 font-serif mb-12">About {vendor.name}</h2>
            <div className="text-muted" style={{ whiteSpace: "pre-line" }}>{vendor.description}</div>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
          <h2 className="section-title" style={{ fontSize: 24 }}>More {vendor.type} partners</h2>
          <div className="grid grid-3 mt-16">
            {related.map((v) => (
              <Link to={`/partners/${v.slug}`} key={v.id} className="artist-card" data-testid={`related-partner-${v.slug}`} style={{ textDecoration: "none" }}>
                <div className="artist-card-cover" style={{ backgroundImage: v.image_url ? `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.6)), url('${v.image_url}')` : undefined, backgroundColor: "rgba(212,175,55,0.08)", backgroundSize: "cover", backgroundPosition: "center" }}>
                  <span className="boost-tag">{TYPE_ICON[v.type]} {v.type.toUpperCase()}</span>
                </div>
                <div className="artist-card-body">
                  <div className="artist-card-name">{v.name}</div>
                  <div className="artist-card-meta">{v.tagline}</div>
                  <div className="artist-card-foot"><span className="artist-card-rating">📍 {v.city || "Nationwide"}</span><span className="artist-card-price text-gold">{v.discount_pct}% off</span></div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
