import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, mediaUrl, pickArtistThumb } from "../lib/api";
import ArtistCardThumb from "../components/ArtistCardThumb";

const CATEGORIES = [
  { slug: "all", name: "All", icon: "✨" },
  { slug: "Bollywood Vocalist", name: "Singers", icon: "🎤" },
  { slug: "DJ / Music Producer", name: "DJs", icon: "🎧" },
  { slug: "Stand-up Comedian", name: "Comedians", icon: "🎭" },
  { slug: "Dancer", name: "Dancers", icon: "💃" },
  { slug: "Anchor", name: "Anchors", icon: "🎙️" },
];

export default function Landing() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);

  useEffect(() => {
    api.get("/artists/featured?limit=8").then(r => setFeatured(r.data)).finally(() => setLoading(false));
    api.get("/cities").then(r => setCities(r.data));
  }, []);

  const search = (e) => {
    e?.preventDefault();
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (city) p.set("city", city);
    window.location.href = `/search?${p.toString()}`;
  };

  return (
    <div data-testid="landing-page">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <Nav />

      <section className="hero">
        <div className="hero-tag">India's #1 Talent Marketplace</div>
        <h1>
          Book India's<br/>
          <span className="gold-grad">Finest</span> Talent,<br/>
          <span className="italic">On Demand</span>
        </h1>
        <p className="hero-sub">
          Join 68,000+ event planners and artists on the most premium talent booking platform in India.
          Transparent pricing, verified artists, secure escrow payments.
        </p>
        <form className="hero-search" onSubmit={search} data-testid="hero-search-form">
          <input
            placeholder="Search for singers, DJs, comedians…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="hero-search-input"
          />
          <select
            className="field-input"
            style={{ maxWidth: 180, background: "transparent", border: "none" }}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            data-testid="hero-city-select"
          >
            <option value="">All Cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="submit" className="btn btn-gold" data-testid="hero-search-btn">Search →</button>
        </form>

        <div className="hero-stats">
          <div>
            <div className="hero-stat-num">5,200+</div>
            <div className="hero-stat-label">Verified Artists</div>
          </div>
          <div>
            <div className="hero-stat-num">48K+</div>
            <div className="hero-stat-label">Events Booked</div>
          </div>
          <div>
            <div className="hero-stat-num">32</div>
            <div className="hero-stat-label">Cities Covered</div>
          </div>
        </div>
      </section>

      <div className="cat-strip mb-24">
        {CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            to={c.slug === "all" ? "/search" : `/search?category=${encodeURIComponent(c.slug)}`}
            className="cat-chip"
            data-testid={`cat-chip-${c.slug}`}
          >
            <span>{c.icon}</span> {c.name}
          </Link>
        ))}
      </div>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div>
              <h2 className="section-title">
                <span className="gold-grad">Featured</span> Artists
              </h2>
              <p className="section-sub">Top-rated, verified talent ready to make your event unforgettable</p>
            </div>
            <Link to="/search" className="btn btn-ghost btn-sm" data-testid="view-all-artists">View All →</Link>
          </div>

          {loading ? (
            <div className="grid grid-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 320 }} />)}
            </div>
          ) : (
            <div className="grid grid-4">
              {featured.map((a) => {
                return (
                <Link to={`/artist/${a.user_id}`} key={a.user_id} className="artist-card" data-testid={`featured-card-${a.user_id}`}>
                  <ArtistCardThumb
                    artist={a}
                    className="artist-card-cover"
                    placeholder={<span style={{ fontSize: "inherit" }}>{a.emoji || "🎤"}</span>}
                  >
                    {a.is_boosted && <span className="boost-tag">★ FEATURED</span>}
                  </ArtistCardThumb>
                  <div className="artist-card-body">
                    <div className="artist-card-name">{a.stage_name}</div>
                    <div className="artist-card-meta">{a.category} · 📍 {a.city}</div>
                    <div className="artist-card-foot">
                      <span className="artist-card-rating">★ {a.rating_avg.toFixed(1)} <span style={{ color: "var(--white-muted)", fontWeight: 400 }}>({a.review_count})</span></span>
                      <span className="artist-card-price">{a.starting_price ? fmtINRFull(a.starting_price) : "—"}<small>/event</small></span>
                    </div>
                  </div>
                </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="card" style={{ padding: 50, textAlign: "center", background: "linear-gradient(135deg, rgba(109,40,217,0.1), rgba(212,175,55,0.05))" }}>
            <div className="font-serif" style={{ fontSize: 36, fontWeight: 700, marginBottom: 10 }}>
              Are you an <span className="gold-grad" style={{ background: "linear-gradient(135deg, var(--gold-light), var(--gold))", WebkitBackgroundClip: "text", color: "transparent" }}>Artist?</span>
            </div>
            <p className="text-muted mb-20" style={{ maxWidth: 560, margin: "0 auto 22px" }}>
              Join 5,200+ verified artists earning premium rates. Get bookings, manage events, receive secure payouts — all in one place.
            </p>
            <Link to="/signup?role=artist" className="btn btn-gold" data-testid="join-as-artist-btn">Join as Artist →</Link>
          </div>
        </div>
      </section>

      <footer style={{ padding: "40px 24px", textAlign: "center", borderTop: "1px solid var(--glass-border)", color: "var(--white-muted)", fontSize: 13 }}>
        © 2026 BookTalent · India's Premium Talent Marketplace
      </footer>
    </div>
  );
}
