import React, { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, pickArtistThumb } from "../lib/api";
import ArtistCardThumb from "../components/ArtistCardThumb";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cities, setCities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [popular, setPopular] = useState([]);
  const [saved, setSaved] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const sugRef = useRef(null);

  // Filters
  const [q, setQ] = useState(params.get("q") || "");
  const [category, setCategory] = useState(params.get("category") || "");
  const [city, setCity] = useState(params.get("city") || "");
  const [minPrice, setMinPrice] = useState(params.get("min_price") || "");
  const [maxPrice, setMaxPrice] = useState(params.get("max_price") || "");
  const [language, setLanguage] = useState(params.get("language") || "");
  const [eventType, setEventType] = useState(params.get("event_type") || "");
  const [minRating, setMinRating] = useState(params.get("min_rating") || "");
  const [minExperience, setMinExperience] = useState(params.get("min_experience") || "");
  const [gender, setGender] = useState(params.get("gender") || "");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [instantOnly, setInstantOnly] = useState(false);
  const [sort, setSort] = useState("relevance");
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get("/catalog/cities").then((r) => setCities(r.data.map((c) => c.name)));
    api.get("/catalog/categories").then((r) => setCategories(r.data));
    api.get("/catalog/languages").then((r) => setLanguages(r.data.map((c) => c.name)));
    api.get("/catalog/event-types").then((r) => setEventTypes(r.data.map((c) => c.name)));
    api.get("/search/popular").then((r) => setPopular(r.data || [])).catch(() => {});
    if (user) api.get("/search/saved").then((r) => setSaved(r.data)).catch(() => {});
  }, [user]);

  const run = async (pg = 1, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (city) p.set("city", city);
    if (minPrice) p.set("min_price", minPrice);
    if (maxPrice) p.set("max_price", maxPrice);
    if (language) p.set("language", language);
    if (eventType) p.set("event_type", eventType);
    if (minRating) p.set("min_rating", minRating);
    if (minExperience) p.set("min_experience", minExperience);
    if (gender) p.set("gender", gender);
    if (featuredOnly) p.set("featured_only", "true");
    if (verifiedOnly) p.set("verified_only", "true");
    if (premiumOnly) p.set("premium_only", "true");
    if (instantOnly) p.set("instant_available", "true");
    p.set("sort", sort);
    p.set("page", pg);
    p.set("limit", "24");
    // Preserve URL only for the base page (not the infinite append calls)
    if (!append) setParams(p);
    setPage(pg);
    try {
      const r = await api.get(`/search/artists?${p.toString()}`);
      setItems(append ? [...items, ...r.data.items] : r.data.items);
      setTotal(r.data.total);
      setPages(r.data.pages);
      setHasMore(pg < r.data.pages);
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  };

  // Filters trigger a fresh page-1 fetch. `run` is redefined every render so
  // including it would loop; it closes over the current filter state, so we
  // list all filter deps explicitly instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(1); }, [category, city, sort, language, eventType, minRating, minExperience, gender, featuredOnly, verifiedOnly, premiumOnly, instantOnly]);

  // Sprint 6 — Infinite scroll via IntersectionObserver on a sentinel element
  const sentinelRef = useRef(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loadingMore && !loading && hasMore) {
        run(page + 1, true);
      }
    }, { rootMargin: "400px" });
    io.observe(sentinelRef.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, page, loadingMore, loading]);

  // Live suggestions
  useEffect(() => {
    if (!q || q.length < 2) { setSuggestions(null); return; }
    const t = setTimeout(() => {
      api.get(`/search/suggestions?q=${encodeURIComponent(q)}`).then((r) => setSuggestions(r.data)).catch(() => setSuggestions(null));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const saveCurrent = async () => {
    if (!user) return toast("Login to save searches");
    const name = window.prompt("Name this search:");
    if (!name) return;
    await api.post("/search/saved", { name, query: q, filters: { category, city, min_price: minPrice, max_price: maxPrice, language, event_type: eventType } });
    toast("Search saved ✓");
    api.get("/search/saved").then((r) => setSaved(r.data));
  };

  const loadSaved = (s) => {
    setQ(s.query || "");
    setCategory(s.filters?.category || "");
    setCity(s.filters?.city || "");
    setMinPrice(s.filters?.min_price || "");
    setMaxPrice(s.filters?.max_price || "");
    setLanguage(s.filters?.language || "");
    setEventType(s.filters?.event_type || "");
    setTimeout(() => run(1), 50);
  };

  const reset = () => {
    setQ(""); setCategory(""); setCity(""); setMinPrice(""); setMaxPrice("");
    setLanguage(""); setEventType(""); setMinRating(""); setMinExperience("");
    setGender(""); setFeaturedOnly(false); setVerifiedOnly(false);
    setPremiumOnly(false); setInstantOnly(false); setSort("relevance");
    setTimeout(() => run(1), 50);
  };

  return (
    <div data-testid="search-page">
      <div className="orb orb-1" />
      <Nav />
      <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
        <h1 className="font-serif" style={{ fontSize: 36, fontWeight: 700, marginBottom: 4 }}>
          Discover <span style={{ background: "linear-gradient(135deg, var(--gold-light), var(--gold))", WebkitBackgroundClip: "text", color: "transparent" }}>Artists</span>
        </h1>
        <p className="text-muted mb-24">Browse {total} verified artists across India</p>

        <form
          onSubmit={(e) => { e.preventDefault(); run(1); }}
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 10, marginBottom: 14 }}
          data-testid="search-filters"
        >
          <div style={{ position: "relative" }} ref={sugRef}>
            <input
              className="field-input" placeholder="Search by name, genre, vibe…"
              value={q} onChange={(e) => setQ(e.target.value)} data-testid="filter-q"
              style={{ width: "100%" }}
            />
            {suggestions && (suggestions.artists?.length || suggestions.categories?.length || suggestions.cities?.length) > 0 && (
              <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, marginTop: 4, maxHeight: 320, overflow: "auto", padding: 6 }} data-testid="search-suggestions">
                {suggestions.artists?.map((a) => (
                  <Link key={a.id} to={`/artist/${a.id}`} className="sb-item" style={{ padding: "6px 10px", display: "block" }}>
                    <div className="fw-600">{a.label}</div>
                    <div className="text-muted fs-11">{a.sub}</div>
                  </Link>
                ))}
                {suggestions.categories?.map((c) => (
                  <div key={c.slug} className="sb-item" style={{ padding: "6px 10px", cursor: "pointer" }} onClick={() => { setCategory(c.label); setSuggestions(null); }}>
                    🗂️ {c.label}
                  </div>
                ))}
                {suggestions.cities?.map((c) => (
                  <div key={c.slug} className="sb-item" style={{ padding: "6px 10px", cursor: "pointer" }} onClick={() => { setCity(c.label); setSuggestions(null); }}>
                    📍 {c.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="filter-category">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.slug} value={c.name}>{c.name}</option>)}
          </select>
          <select className="field-input" value={city} onChange={(e) => setCity(e.target.value)} data-testid="filter-city">
            <option value="">All Cities</option>
            {cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="field-input" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} data-testid="filter-budget">
            <option value="">Any Budget</option>
            <option value="25000">Up to ₹25K</option>
            <option value="50000">Up to ₹50K</option>
            <option value="100000">Up to ₹1L</option>
            <option value="200000">Up to ₹2L</option>
          </select>
          <button className="btn btn-gold" type="submit" data-testid="filter-apply">Search</button>
        </form>

        <div className="flex gap-8 mb-12" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          <button className="btn btn-ghost btn-xs" onClick={() => setShowAdvanced(!showAdvanced)} data-testid="toggle-advanced">
            {showAdvanced ? "▲ Hide" : "▼ Show"} Advanced Filters
          </button>
          <button className="btn btn-ghost btn-xs" onClick={reset} data-testid="filter-reset">Reset</button>
          {user && <button className="btn btn-ghost btn-xs" onClick={saveCurrent} data-testid="save-search">⭐ Save Search</button>}
          {popular.slice(0, 5).map((p) => (
            <button key={p.query} className="btn btn-ghost btn-xs" onClick={() => { setQ(p.query); setTimeout(() => run(1), 50); }} data-testid={`pop-${p.query}`}>
              🔥 {p.query} ({p.count})
            </button>
          ))}
        </div>

        {showAdvanced && (
          <div className="card card-pad mb-16" data-testid="advanced-filters">
            <div className="grid grid-4 gap-12">
              <select className="field-input" value={language} onChange={(e) => setLanguage(e.target.value)} data-testid="filter-language">
                <option value="">Any Language</option>
                {languages.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className="field-input" value={eventType} onChange={(e) => setEventType(e.target.value)} data-testid="filter-event-type">
                <option value="">Any Event Type</option>
                {eventTypes.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <select className="field-input" value={minRating} onChange={(e) => setMinRating(e.target.value)} data-testid="filter-min-rating">
                <option value="">Any Rating</option>
                <option value="3">3★+</option>
                <option value="4">4★+</option>
                <option value="4.5">4.5★+</option>
              </select>
              <select className="field-input" value={minExperience} onChange={(e) => setMinExperience(e.target.value)} data-testid="filter-experience">
                <option value="">Any Experience</option>
                <option value="2">2+ years</option>
                <option value="5">5+ years</option>
                <option value="10">10+ years</option>
              </select>
              <select className="field-input" value={gender} onChange={(e) => setGender(e.target.value)} data-testid="filter-gender">
                <option value="">Any Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
              <input className="field-input" type="number" placeholder="Min price ₹" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} data-testid="filter-min-price" />
              <div className="flex gap-8 items-center" style={{ gridColumn: "span 2", flexWrap: "wrap" }}>
                <label className="flex items-center gap-4 fs-12"><input type="checkbox" checked={featuredOnly} onChange={(e) => setFeaturedOnly(e.target.checked)} data-testid="filter-featured" /> Featured</label>
                <label className="flex items-center gap-4 fs-12"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} data-testid="filter-verified" /> Verified KYC</label>
                <label className="flex items-center gap-4 fs-12"><input type="checkbox" checked={premiumOnly} onChange={(e) => setPremiumOnly(e.target.checked)} data-testid="filter-premium" /> Premium</label>
                <label className="flex items-center gap-4 fs-12"><input type="checkbox" checked={instantOnly} onChange={(e) => setInstantOnly(e.target.checked)} data-testid="filter-instant" /> Instant Available</label>
              </div>
            </div>
            {saved.length > 0 && (
              <div className="mt-12" style={{ marginTop: 12 }}>
                <div className="fs-12 text-muted mb-4">Saved Searches:</div>
                <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                  {saved.map((s) => (
                    <button key={s.id} className="btn btn-ghost btn-xs" onClick={() => loadSaved(s)} data-testid={`saved-${s.id}`}>⭐ {s.name}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between items-center mb-16">
          <div className="text-muted fs-13">{total} artists found</div>
          <select className="field-input" style={{ width: 200 }} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="filter-sort">
            <option value="relevance">Most Relevant</option>
            <option value="rating">Highest Rated</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {loading ? (
          <div className="grid grid-4">
            {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 320 }} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">No artists found</div>
            <p>Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div className="grid grid-4">
              {items.map((a) => {
                return (
                  <Link to={`/artist/${a.user_id}`} key={a.user_id} className="artist-card" data-testid={`artist-card-${a.user_id}`}>
                    <ArtistCardThumb
                      artist={a}
                      className="artist-card-cover"
                      placeholder={<span style={{ fontSize: "inherit" }}>{a.emoji || "🎤"}</span>}
                    >
                      {a.is_featured && <span className="boost-tag">★ FEATURED</span>}
                      {a.plan_code === "elite" && <span className="boost-tag" style={{ top: 30, background: "linear-gradient(135deg, #f472b6, #d4af37)" }}>👑 ELITE</span>}
                      {a.plan_code === "platinum" && <span className="boost-tag" style={{ top: 30, background: "linear-gradient(135deg, #a78bfa, #7c3aed)" }}>💎 PLATINUM</span>}
                      {a.plan_code === "gold" && !a.is_featured && <span className="boost-tag" style={{ background: "linear-gradient(135deg, #fbbf24, #d4af37)" }}>🥇 GOLD</span>}
                    </ArtistCardThumb>
                    <div className="artist-card-body">
                      <div className="artist-card-name">
                        {a.stage_name}
                        {a.verified_badge && <span style={{ color: "var(--gold)", marginLeft: 6 }}>✓</span>}
                      </div>
                      <div className="artist-card-meta">{a.category} · 📍 {a.city}</div>
                      <div className="artist-card-foot">
                        <span className="artist-card-rating">
                          ★ {(a.rating_avg || 0).toFixed(1)}{" "}
                          <span style={{ color: "var(--white-muted)", fontWeight: 400 }}>({a.review_count || 0})</span>
                        </span>
                        <span className="artist-card-price">{a.starting_price || a.base_price ? fmtINRFull(a.starting_price || a.base_price) : "—"}<small>/event</small></span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {pages > 1 && hasMore && (
              <div ref={sentinelRef} style={{ padding: 32, textAlign: "center" }} data-testid="infinite-scroll-sentinel">
                {loadingMore ? (
                  <div className="grid grid-4" style={{ marginTop: 12 }}>
                    {[...Array(4)].map((_, i) => <div key={`m${i}`} className="skeleton" style={{ height: 320 }} />)}
                  </div>
                ) : (
                  <div className="text-muted fs-13">Scroll to load more…</div>
                )}
              </div>
            )}
            {pages > 1 && !hasMore && (
              <div className="text-muted text-center fs-13" style={{ padding: 24 }} data-testid="infinite-scroll-end">
                — End of results —
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
