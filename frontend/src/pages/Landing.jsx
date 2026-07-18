import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import SEO from "../components/SEO";
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
  const [rails, setRails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);
  const [featuredFaqs, setFeaturedFaqs] = useState([]);
  const [openFaq, setOpenFaq] = useState({});
  const [spotlight, setSpotlight] = useState({ cards: [], latest_booking: null });

  useEffect(() => {
    // Sprint 5 — dynamic homepage rails
    const geo = localStorage.getItem("bt_city") || "";
    api.get(`/homepage/sections?limit=8${geo ? `&city=${encodeURIComponent(geo)}` : ""}`).then((r) => {
      setRails(r.data || []);
    }).catch(() => setRails([])).finally(() => setLoading(false));
    api.get("/cities").then(r => setCities(r.data));
    // Iter 39 — featured FAQs for the landing page
    api.get("/faqs/search?featured=true").then(r => setFeaturedFaqs(r.data || [])).catch(() => {});
    // Iter 42 — Homepage Banner spotlight cards + booking pulse
    api.get("/homepage/spotlight").then(r => setSpotlight(r.data || { cards: [] })).catch(() => {});
  }, []);

  const search = (e) => {
    e?.preventDefault();
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (city) {
      p.set("city", city);
      localStorage.setItem("bt_city", city);
    }
    window.location.href = `/search?${p.toString()}`;
  };

  return (
    <div data-testid="landing-page">
      <SEO
        title="Book India's Finest Talent, On Demand"
        description="Book verified singers, DJs, comedians, dancers and anchors for weddings, corporate events, birthdays and private parties. Transparent 5% platform fee, direct settlement with your artist."
        keywords="book artists india, book singer, book DJ, book comedian, wedding entertainment, corporate event artists, book anchor, book dancer"
        path="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "BookTalent",
          url: "https://booktalent.com",
          potentialAction: {
            "@type": "SearchAction",
            target: "https://booktalent.com/search?q={search_term_string}",
            "query-input": "required name=search_term_string",
          },
        }}
      />
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <Nav />

      <section className="hero hero-split" data-testid="hero-split">
        <div className="hero-left">
          <div className="hero-tag">✦ India's #1 Premium Talent Marketplace</div>
          <h1>
            India's<br/>
            <span className="gold-grad">Finest Talent,</span><br/>
            <span className="italic">On Demand</span>
          </h1>
          <p className="hero-sub" style={{ maxWidth: 520 }}>
            Discover, compare and instantly book singers, DJs, comedians, anchors and 5000+ verified artists for weddings, corporate events, concerts and private shows.
          </p>
          <div className="hero-cta-row" data-testid="hero-cta-row">
            <Link to="/search" className="btn btn-gold btn-lg" data-testid="hero-cta-browse">
              ✦ Browse Artists
            </Link>
            <Link to="/signup?role=artist" className="btn btn-ghost btn-lg" data-testid="hero-cta-list">
              List as Artist
            </Link>
          </div>
          <form className="hero-search hero-search-inline" onSubmit={search} data-testid="hero-search-form">
            <span className="hero-search-icon">🔍</span>
            <input
              placeholder='"Punjabi singer for wedding in Mumbai under ₹80k"'
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="hero-search-input"
            />
            <button type="submit" className="btn btn-purple" data-testid="hero-search-btn">Search</button>
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
        </div>

        <div className="hero-right" data-testid="hero-spotlight">
          {spotlight.cards.slice(0, 3).map((c, i) => (
            <Link
              key={c.user_id}
              to={`/artist/${c.slug || c.user_id}`}
              className={`spotlight-card spotlight-card-${i + 1}`}
              data-testid={`spotlight-card-${i}`}
              {...(c.profile_image ? {
                style: {
                  background: `linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.65)), url(${c.profile_image}) center/cover`,
                },
              } : {})}
            >
              {!c.profile_image && (
                <div className="spotlight-emoji" aria-hidden>
                  {c.emoji || (c.category?.toLowerCase().includes("dj") ? "🎧" : c.category?.toLowerCase().includes("com") ? "🎭" : "🎤")}
                </div>
              )}
              <div className="spotlight-body">
                {c.kyc_status === "approved" && <span className="spotlight-badge">✓ Verified Artist</span>}
                <div className="spotlight-name">{c.stage_name}</div>
                <div className="spotlight-cat">{c.category}</div>
                <div className="spotlight-foot">
                  <span className="spotlight-rating">
                    {"★".repeat(Math.round(c.rating_avg || 0)) || "★"} ({c.review_count || 0})
                  </span>
                  {c.starting_price && <span className="spotlight-price">{fmtINRFull(c.starting_price).replace("₹", "₹")}</span>}
                </div>
              </div>
            </Link>
          ))}
          {spotlight.latest_booking && (
            <div className="spotlight-toast" data-testid="spotlight-toast">
              <div className="spotlight-toast-icon">📅</div>
              <div>
                <div className="spotlight-toast-title">New booking confirmed</div>
                <div className="spotlight-toast-sub">
                  {spotlight.latest_booking.venue} · {spotlight.latest_booking.event_date}
                </div>
              </div>
            </div>
          )}
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
          {loading ? (
            <div className="grid grid-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 320 }} />)}
            </div>
          ) : (
            rails.map((rail) => (
              <HomeRail key={rail.code} rail={rail} />
            ))
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

      {featuredFaqs.length > 0 && (
        <section className="faq-hero" data-testid="landing-faq-section">
          <div className="faq-hero-head">
            <h2 style={{ fontFamily: "var(--font-serif)" }}>Frequently Asked <span className="gold-grad">Questions</span></h2>
            <p className="text-muted">Everything you need to know before booking your next event.</p>
          </div>
          <div className="faq-list">
            {featuredFaqs.map((f) => (
              <div key={f.id} className={`faq-row ${openFaq[f.id] ? "open" : ""}`} data-testid={`landing-faq-${f.id}`}>
                <button
                  className="faq-q"
                  onClick={() => setOpenFaq({ ...openFaq, [f.id]: !openFaq[f.id] })}
                  aria-expanded={!!openFaq[f.id]}
                  data-testid={`landing-faq-toggle-${f.id}`}
                >
                  <span>{f.question}</span>
                  <span className="faq-caret">{openFaq[f.id] ? "−" : "+"}</span>
                </button>
                {openFaq[f.id] && <div className="faq-a">{f.answer}</div>}
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 24 }}>
            <Link to="/help" className="btn btn-ghost" data-testid="landing-faq-view-all">
              View all answers in Help Center →
            </Link>
          </div>
        </section>
      )}

      <Footer />
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Sprint 5 — Dynamic homepage rail. Horizontal-scrolling artist row.
// ────────────────────────────────────────────────────────────────────────
function HomeRail({ rail }) {
  if (!rail?.items?.length) return null;
  // Dedupe by user_id to guard against duplicate-key warnings
  const seen = new Set();
  const items = rail.items.filter((a) => {
    if (!a?.user_id || seen.has(a.user_id)) return false;
    seen.add(a.user_id);
    return true;
  });
  return (
    <div className="mb-32" data-testid={`rail-${rail.code}`} style={{ marginBottom: 40 }}>
      <div className="section-head">
        <div>
          <h2 className="section-title" style={{ fontSize: 24 }}>{rail.title}</h2>
          <p className="section-sub">{rail.subtitle}</p>
        </div>
        <Link to={`/search?section=${encodeURIComponent(rail.code)}`} className="btn btn-ghost btn-sm" data-testid={`rail-more-${rail.code}`}>View All →</Link>
      </div>
      <div className="grid grid-4">
        {items.map((a) => (
          <Link to={`/artist/${a.user_id}`} key={a.user_id} className="artist-card" data-testid={`rail-card-${rail.code}-${a.user_id}`}>
            <ArtistCardThumb
              artist={a}
              className="artist-card-cover"
              placeholder={<span style={{ fontSize: "inherit" }}>{a.emoji || "🎤"}</span>}
            >
              {a.is_boosted && <span className="boost-tag">★ BOOSTED</span>}
              {a.plan_code === "elite" && <span className="boost-tag" style={{ top: 30, background: "linear-gradient(135deg, #f472b6, #d4af37)" }}>👑 ELITE</span>}
              {a.plan_code === "platinum" && <span className="boost-tag" style={{ top: 30, background: "linear-gradient(135deg, #a78bfa, #7c3aed)" }}>💎 PLATINUM</span>}
              {a.plan_code === "gold" && !a.is_boosted && <span className="boost-tag" style={{ background: "linear-gradient(135deg, #fbbf24, #d4af37)" }}>🥇 GOLD</span>}
            </ArtistCardThumb>
            <div className="artist-card-body">
              <div className="artist-card-name">
                {a.stage_name}
                {a.verified_badge && <span style={{ color: "var(--gold)", marginLeft: 6 }}>✓</span>}
              </div>
              <div className="artist-card-meta">{a.category} · 📍 {a.city}</div>
              <div className="artist-card-foot">
                <span className="artist-card-rating">★ {(a.rating_avg || 0).toFixed(1)} <span style={{ color: "var(--white-muted)", fontWeight: 400 }}>({a.review_count || 0})</span></span>
                <span className="artist-card-price">{a.starting_price ? fmtINRFull(a.starting_price) : "—"}<small>/event</small></span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
