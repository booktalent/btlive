import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import SEO, { buildBreadcrumb } from "../components/SEO";
import AvailabilityCalendar from "../components/AvailabilityCalendar";
import api, { fmtINRFull, mediaUrl } from "../lib/api";
import { useAuth } from "../lib/auth";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ArtistProfile() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("about");
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [artistId, setArtistId] = useState(id);
  const [lightbox, setLightbox] = useState(null); // { items: MediaItem[], idx: number }
  const nav = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    // Support both /artist/:uuid and SEO-friendly /artist/:slug URLs
    const load = async () => {
      let uid = id;
      if (!UUID_RX.test(id)) {
        try {
          const r = await api.get(`/artists/slug/${id}`);
          uid = r.data.user_id;
        } catch (_) { setData({ notFound: true }); return; }
      }
      setArtistId(uid);
      try {
        const r = await api.get(`/artists/${uid}`);
        setData(r.data);
        const pop = r.data.packages.find((p) => p.is_popular) || r.data.packages[0];
        if (pop) setSelectedPkg(pop);
      } catch (_) { setData({ notFound: true }); }
    };
    load();
  }, [id]);

  if (data?.notFound) {
    return (
      <div>
        <SEO title="Artist Not Found" noindex path={`/artist/${id}`} />
        <Nav />
        <section className="section container" style={{ minHeight: "50vh", textAlign: "center", paddingTop: 80 }}>
          <div style={{ fontSize: 72 }}>🎤</div>
          <h1>Artist Not Found</h1>
          <Link to="/search" className="btn btn-gold">Browse all artists →</Link>
        </section>
        <Footer />
      </div>
    );
  }
  if (!data) return (
    <div>
      <Nav />
      <div className="loading"><div className="spinner" /></div>
    </div>
  );

  const { profile, packages, reviews, media, availability } = data;
  const galleryMedia = media.filter((m) => m.type === "gallery");
  const videoMedia = media.filter((m) => m.type === "video" || m.type === "reel");

  const startBooking = () => {
    if (!user) { nav("/login"); return; }
    if (user.role === "artist") { alert("Artists cannot book themselves"); return; }
    nav(`/book/${artistId}?pkg=${selectedPkg.id}`);
  };

  // ── SEO JSON-LD (Person + Offer for the cheapest package) ───────────
  const cheapestPkg = (packages || []).slice().sort((a, b) => (a.price || 0) - (b.price || 0))[0];
  const seoImg = profile.profile_image ? mediaUrl(profile.profile_image) : undefined;
  const seoPath = `/artist/${profile.slug || artistId}`;
  const personLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.stage_name,
    jobTitle: profile.category,
    address: { "@type": "PostalAddress", addressLocality: profile.city, addressCountry: "IN" },
    image: seoImg,
    url: `https://booktalent.com${seoPath}`,
    aggregateRating: profile.review_count > 0 ? {
      "@type": "AggregateRating",
      ratingValue: (profile.rating_avg || 0).toFixed(1),
      reviewCount: profile.review_count,
    } : undefined,
    ...(cheapestPkg ? { makesOffer: { "@type": "Offer", price: cheapestPkg.price, priceCurrency: "INR", name: cheapestPkg.name } } : {}),
  };

  return (
    <div data-testid="artist-profile-page">
      <SEO
        title={`Book ${profile.stage_name} — ${profile.category} in ${profile.city}`}
        description={`Book ${profile.stage_name}, a verified ${profile.category} from ${profile.city}. ${profile.review_count || 0} reviews · Starting ₹${profile.starting_price || cheapestPkg?.price || ""}. Check availability and packages on BookTalent.`}
        keywords={`book ${profile.stage_name}, ${profile.category} ${profile.city}, hire ${profile.category}, ${profile.category} for wedding`}
        image={seoImg}
        path={seoPath}
        jsonLd={[
          personLd,
          buildBreadcrumb([
            { name: "Home", url: "/" },
            { name: "Artists", url: "/search" },
            { name: profile.category, url: `/search?category=${encodeURIComponent(profile.category)}` },
            { name: profile.stage_name, url: seoPath },
          ]),
        ]}
      />
      <Nav />
      <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div className="text-muted fs-12 mb-16">
          <Link to="/">Home</Link> › <Link to="/search">Artists</Link> › <Link to={`/search?category=${encodeURIComponent(profile.category)}`}>{profile.category}</Link> ›{" "}
          <span style={{ color: "var(--white)" }}>{profile.stage_name}</span>
        </div>

        <div style={{
          height: 280, borderRadius: 18,
          background: profile.cover_image
            ? `linear-gradient(180deg, rgba(9,9,18,0.2), rgba(9,9,18,0.7)), url(${mediaUrl(profile.cover_image)}?v=${profile.updated_at || ""}) center/cover`
            : "linear-gradient(135deg, #1A0B3B, #6D28D9)",
          display: "grid", placeItems: "center",
          fontSize: profile.cover_image ? 0 : 100,
          position: "relative", overflow: "hidden",
        }} data-testid="profile-cover-banner">
          {!profile.cover_image && (profile.emoji || "🎤")}
          <div style={{ position: "absolute", inset: 0, background: profile.cover_image ? "transparent" : "linear-gradient(180deg, transparent 40%, rgba(9,9,18,0.8))" }} />
        </div>

        <div className="profile-header-row" data-testid="profile-header">
          <div
            className="avatar avatar-xl profile-header-avatar"
            style={{
              background: profile.profile_image
                ? `url(${mediaUrl(profile.profile_image)}?v=${profile.updated_at || ""}) center/cover`
                : "linear-gradient(135deg, var(--purple), var(--gold))",
              fontSize: profile.profile_image ? 0 : undefined,
            }}
            data-testid="profile-avatar"
          >
            {!profile.profile_image && (profile.emoji || "🎤")}
          </div>
          <div className="profile-header-info">
            <h1 className="font-serif profile-name" data-testid="artist-name">{profile.stage_name}</h1>
            <div className="flex gap-8 items-center" style={{ flexWrap: "wrap" }}>
              {profile.kyc_status === "approved" && <span className="pill pill-green">✓ KYC Verified</span>}
              <span className="pill pill-gold">{profile.category}</span>
              <span className="text-muted fs-13">📍 {profile.city}</span>
            </div>
          </div>
          <div className="profile-header-cta">
            <div className="pill pill-amber">⚡ Responds in ~2 hrs</div>
            <div className="text-muted fs-12 mt-8">{profile.profile_views} profile views</div>
          </div>
        </div>

        <div className="profile-stats-grid mb-24">
          <div className="card card-pad text-center">
            <div className="font-serif fs-20 fw-700 text-gold">★ {profile.rating_avg.toFixed(1)}</div>
            <div className="text-muted fs-11 mt-4">Rating</div>
          </div>
          <div className="card card-pad text-center">
            <div className="font-serif fs-20 fw-700">{profile.review_count}</div>
            <div className="text-muted fs-11 mt-4">Reviews</div>
          </div>
          <div className="card card-pad text-center">
            <div className="font-serif fs-20 fw-700">{profile.events_done}</div>
            <div className="text-muted fs-11 mt-4">Events Done</div>
          </div>
          <div className="card card-pad text-center">
            <div className="font-serif fs-20 fw-700">{profile.experience_years || 8} yrs</div>
            <div className="text-muted fs-11 mt-4">Experience</div>
          </div>
        </div>

        <div className="profile-main-grid">
          <div>
            <div className="tab-bar" data-testid="profile-tabs">
              {["about", "media", "packages", "availability", "reviews"].map((t) => (
                <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {tab === "about" && (
              <div className="card card-pad" data-testid="tab-about-content">
                <h3 className="card-title mb-16">About {profile.stage_name.split(" ")[0]}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--white-muted)", marginBottom: 24 }}>
                  {profile.bio || "No bio yet."}
                </p>
                <div className="divider" />
                <div className="grid grid-2 mt-16">
                  <div style={{ background: "var(--glass)", borderRadius: 10, padding: 14 }}>
                    <div className="text-muted fs-11 mb-4">LANGUAGES</div>
                    <div className="fs-13">{(profile.languages || []).join(" · ") || "—"}</div>
                  </div>
                  <div style={{ background: "var(--glass)", borderRadius: 10, padding: 14 }}>
                    <div className="text-muted fs-11 mb-4">GENRES</div>
                    <div className="fs-13">{(profile.genres || []).join(" · ") || "—"}</div>
                  </div>
                  <div style={{ background: "var(--glass)", borderRadius: 10, padding: 14 }}>
                    <div className="text-muted fs-11 mb-4">EVENT TYPES</div>
                    <div className="fs-13">{(profile.event_types || []).join(" · ") || "Weddings · Corporate · Concerts"}</div>
                  </div>
                  <div style={{ background: "var(--glass)", borderRadius: 10, padding: 14 }}>
                    <div className="text-muted fs-11 mb-4">TRAVEL</div>
                    <div className="fs-13">{profile.travel_range || "Pan India"}</div>
                  </div>
                </div>
              </div>
            )}

            {tab === "media" && (
              <div className="card card-pad" data-testid="tab-media-content">
                <h3 className="card-title mb-16">Performance Gallery</h3>
                {media.length === 0 ? (
                  <div className="empty"><div className="empty-icon">📷</div><div className="empty-title">No media yet</div></div>
                ) : (() => {
                  const viewable = media.filter((m) => m.type !== "kyc");
                  const items = viewable.map((m) => ({
                    id: m.id,
                    src: `${api.defaults.baseURL}/media/${m.id}`,
                    isVideo: m.mime?.startsWith("video/"),
                    title: m.title || "",
                  }));
                  return (
                    <div className="media-grid">
                      {items.map((it, i) => (
                        <button
                          key={it.id}
                          type="button"
                          className="media-tile"
                          data-testid={`media-${it.id}`}
                          onClick={() => setLightbox({ items, idx: i })}
                          aria-label={`Open ${it.isVideo ? "video" : "image"} ${i + 1} of ${items.length}`}
                        >
                          {it.isVideo ? <video src={it.src} muted /> : <img src={it.src} alt={it.title} />}
                          <span className="media-tile-play" aria-hidden>{it.isVideo ? "▶" : "⤢"}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {tab === "packages" && (
              <div className="card card-pad" data-testid="tab-packages-content">
                <h3 className="card-title mb-16">Pricing Packages</h3>
                <div className="grid grid-3">
                  {packages.map((p) => (
                    <div key={p.id} className={`pkg-card ${p.is_popular ? "popular" : ""}`} data-testid={`package-card-${p.id}`}>
                      {p.is_popular && <span className="popular-tag">★ MOST POPULAR</span>}
                      <div className="pkg-name">{p.name}</div>
                      <div className="text-muted fs-12 mb-12">⏱ {p.duration}</div>
                      <div className="pkg-price">{fmtINRFull(p.price)} <span style={{ fontSize: 12, color: "var(--white-muted)", fontWeight: 400 }}>/event</span></div>
                      <ul className="pkg-features">{p.features.map((f, i) => <li key={`${p.id}-f-${i}-${f}`}>{f}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "availability" && (
              <div data-testid="tab-availability-content">
                <div style={{ marginBottom: 12, color: "var(--white-muted)", fontSize: 13 }}>
                  🗓️ Pick a date to check {profile.stage_name.split(" ")[0]}'s live availability. Dates in red are already booked or blocked.
                </div>
                <AvailabilityCalendar artistUserId={profile.user_id} onPick={() => {}} />
              </div>
            )}

            {tab === "reviews" && (
              <div className="card card-pad" data-testid="tab-reviews-content">
                <div className="flex gap-24 mb-24">
                  <div className="text-center">
                    <div className="font-serif" style={{ fontSize: 56, fontWeight: 700, color: "var(--gold-light)", lineHeight: 1 }}>{profile.rating_avg.toFixed(1)}</div>
                    <div className="text-gold mt-8" style={{ letterSpacing: 3 }}>★★★★★</div>
                    <div className="text-muted fs-12 mt-4">{profile.review_count} reviews</div>
                  </div>
                </div>
                {reviews.length === 0 ? (
                  <div className="empty"><div className="empty-icon">⭐</div><div className="empty-title">No reviews yet</div></div>
                ) : reviews.map((r) => (
                  <div key={r.id} style={{ padding: 16, borderBottom: "1px solid var(--glass-border)" }} data-testid={`review-${r.id}`}>
                    <div className="flex items-center gap-12 mb-8">
                      <div className="avatar">{r.customer_name?.[0] || "U"}</div>
                      <div style={{ flex: 1 }}>
                        <div className="fw-600 fs-14">{r.customer_name}</div>
                        <div className="text-muted fs-11">{r.event_type}</div>
                      </div>
                      <div className="text-gold">{"★".repeat(r.rating)}</div>
                    </div>
                    <div className="fs-13" style={{ color: "var(--white-muted)", lineHeight: 1.7 }}>{r.text}</div>
                    {r.reply && (
                      <div style={{ marginTop: 12, padding: 12, background: "rgba(109,40,217,0.08)", borderRadius: 10 }}>
                        <div className="text-muted fs-11 mb-4">Reply from {profile.stage_name}:</div>
                        <div className="fs-13">{r.reply}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div data-testid="booking-sidebar">
            <div className="card card-pad" style={{ position: "sticky", top: 90 }}>
              {selectedPkg && (
                <>
                  <div className="font-serif" style={{ fontSize: 32, fontWeight: 700, color: "var(--gold-light)" }}>
                    {fmtINRFull(selectedPkg.price)}
                  </div>
                  <div className="text-muted fs-12 mb-20">Starting price · {selectedPkg.name}</div>
                  <div className="field">
                    <div className="field-label">Package</div>
                    <select className="field-input" value={selectedPkg.id} onChange={(e) => setSelectedPkg(packages.find(p => p.id === e.target.value))} data-testid="pkg-select">
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {fmtINRFull(p.price)}</option>
                      ))}
                    </select>
                  </div>
                  <button className="btn btn-gold btn-block" onClick={startBooking} data-testid="confirm-booking-btn">
                    🔐 Book Now
                  </button>
                  <div style={{ marginTop: 16, fontSize: 12, color: "var(--white-muted)" }}>
                    <div style={{ padding: "8px 0" }}>✓ Auto-generated legal contract</div>
                    <div style={{ padding: "8px 0" }}>✓ Direct payment to artist as per agreement</div>
                    <div style={{ padding: "8px 0" }}>✓ Free cancellation within 24 hrs</div>
                    <div style={{ padding: "8px 0" }}>✓ GST invoice included</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {selectedPkg && (
        <div className="mobile-book-bar" data-testid="mobile-book-bar">
          <div className="mobile-book-bar-price">
            <div className="mobile-book-bar-label">Starting from</div>
            <div className="mobile-book-bar-amount">{fmtINRFull(selectedPkg.price)}</div>
          </div>
          <button
            type="button"
            className="btn btn-gold mobile-book-bar-cta"
            onClick={startBooking}
            data-testid="mobile-book-bar-btn"
          >
            🔐 Book Now
          </button>
        </div>
      )}
      {lightbox && (
        <MediaCarousel lightbox={lightbox} onClose={() => setLightbox(null)} onChange={setLightbox} />
      )}
      <Footer />
    </div>
  );
}


// ─── Swipeable / keyboard-navigable media carousel ─────────────────────
function MediaCarousel({ lightbox, onClose, onChange }) {
  const { items, idx } = lightbox;
  const total = items.length;
  const current = items[idx];
  const touchRef = React.useRef({ x: 0, active: false });

  const goPrev = React.useCallback(() => {
    if (total < 2) return;
    onChange({ items, idx: (idx - 1 + total) % total });
  }, [items, idx, total, onChange]);

  const goNext = React.useCallback(() => {
    if (total < 2) return;
    onChange({ items, idx: (idx + 1) % total });
  }, [items, idx, total, onChange]);

  // Keyboard: ← → for nav, Esc for close
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, onClose]);

  // Preload neighbours to make swipe feel instant
  React.useEffect(() => {
    if (total < 2) return;
    [1, -1].forEach((d) => {
      const n = items[(idx + d + total) % total];
      if (n && !n.isVideo) { const im = new Image(); im.src = n.src; }
    });
  }, [idx, items, total]);

  const onTouchStart = (e) => { touchRef.current = { x: e.touches[0].clientX, active: true }; };
  const onTouchEnd = (e) => {
    if (!touchRef.current.active) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchRef.current.x) - touchRef.current.x;
    touchRef.current.active = false;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) goPrev(); else goNext();
  };

  return (
    <div
      className="media-lightbox"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="media-lightbox"
    >
      <button
        type="button"
        className="media-lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close viewer"
        data-testid="media-lightbox-close"
      >×</button>

      {total > 1 && (
        <>
          <button
            type="button"
            className="media-lightbox-nav prev"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            aria-label="Previous"
            data-testid="media-lightbox-prev"
          >‹</button>
          <button
            type="button"
            className="media-lightbox-nav next"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            aria-label="Next"
            data-testid="media-lightbox-next"
          >›</button>
        </>
      )}

      <div
        className="media-lightbox-content"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {current.isVideo ? (
          <video
            key={current.id}
            src={current.src}
            controls
            autoPlay
            playsInline
            data-testid="media-lightbox-video"
          />
        ) : (
          <img
            key={current.id}
            src={current.src}
            alt={current.title}
            data-testid="media-lightbox-image"
          />
        )}
        {(current.title || total > 1) && (
          <div className="media-lightbox-title">
            {current.title}
            {total > 1 && <span className="media-lightbox-counter"> · {idx + 1} / {total}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
