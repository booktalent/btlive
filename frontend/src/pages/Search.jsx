import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, pickArtistThumb } from "../lib/api";

const CATEGORIES = [
  "Bollywood Vocalist", "Classical Vocalist", "Carnatic Vocalist", "Sufi Vocalist", "Ghazal Singer",
  "DJ / Music Producer", "Stand-up Comedian", "Anchor / Emcee", "Dancer / Troupe", "Live Band",
];

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);

  const [q, setQ] = useState(params.get("q") || "");
  const [category, setCategory] = useState(params.get("category") || "");
  const [city, setCity] = useState(params.get("city") || "");
  const [maxPrice, setMaxPrice] = useState(params.get("max_price") || "");
  const [sort, setSort] = useState("relevance");

  useEffect(() => { api.get("/cities").then(r => setCities(r.data)); }, []);

  const run = async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (category) p.set("category", category);
    if (city) p.set("city", city);
    if (maxPrice) p.set("max_price", maxPrice);
    if (sort) p.set("sort", sort);
    setParams(p);
    try {
      const r = await api.get(`/artists/search?${p.toString()}&limit=24`);
      setItems(r.data.items);
      setTotal(r.data.total);
    } finally { setLoading(false); }
  };

  useEffect(() => { run(); /* eslint-disable-next-line */ }, [category, city, sort]);

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
          onSubmit={(e) => { e.preventDefault(); run(); }}
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr auto", gap: 10, marginBottom: 22 }}
          data-testid="search-filters"
        >
          <input
            className="field-input" placeholder="Search by name, genre, vibe…"
            value={q} onChange={(e) => setQ(e.target.value)} data-testid="filter-q"
          />
          <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="filter-category">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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

        <div className="flex justify-between items-center mb-16">
          <div className="text-muted fs-13">{total} artists found</div>
          <select className="field-input" style={{ width: 200 }} value={sort} onChange={(e) => setSort(e.target.value)} data-testid="filter-sort">
            <option value="relevance">Most Relevant</option>
            <option value="rating">Highest Rated</option>
            <option value="popular">Most Booked</option>
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
          <div className="grid grid-4">
            {items.map((a) => {
              const thumb = pickArtistThumb(a);
              return (
              <Link to={`/artist/${a.user_id}`} key={a.user_id} className="artist-card" data-testid={`artist-card-${a.user_id}`}>
                <div className="artist-card-cover" style={
                  thumb
                    ? { backgroundImage: `url(${thumb})`, backgroundSize: "cover", backgroundPosition: "center", fontSize: 0 }
                    : {}
                }>
                  {!thumb && (a.emoji || "🎤")}
                  {a.is_boosted && <span className="boost-tag">★ FEATURED</span>}
                </div>
                <div className="artist-card-body">
                  <div className="artist-card-name">{a.stage_name}</div>
                  <div className="artist-card-meta">{a.category} · 📍 {a.city}</div>
                  <div className="artist-card-foot">
                    <span className="artist-card-rating">
                      ★ {(a.rating_avg || 0).toFixed(1)}{" "}
                      <span style={{ color: "var(--white-muted)", fontWeight: 400 }}>({a.review_count})</span>
                    </span>
                    <span className="artist-card-price">{a.starting_price ? fmtINRFull(a.starting_price) : "—"}<small>/event</small></span>
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
