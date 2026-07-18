import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import SEO, { buildBreadcrumb } from "../components/SEO";
import api from "../lib/api";

/**
 * /blog — SEO-optimised blog index. Pulls from GET /api/blogs.
 */
export default function BlogList() {
  const [blogs, setBlogs] = useState(null);
  useEffect(() => {
    api.get("/blogs").then((r) => setBlogs(r.data || [])).catch(() => setBlogs([]));
  }, []);

  return (
    <div data-testid="blog-list-page">
      <SEO
        title="BookTalent Blog — Tips, News & Guides"
        description="Read expert guides on booking artists, planning weddings, corporate events and private parties. Stay updated with BookTalent."
        keywords="booktalent blog, event planning, wedding artists, corporate events"
        path="/blog"
        jsonLd={buildBreadcrumb([{ name: "Home", url: "/" }, { name: "Blog", url: "/blog" }])}
      />
      <Nav />
      <section className="section container" style={{ paddingTop: 60, minHeight: "60vh" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontSize: 42 }}>The BookTalent Blog</h1>
          <p className="text-muted" style={{ maxWidth: 640, margin: "0 auto" }}>
            Guides, artist spotlights and industry news to help you plan the perfect event.
          </p>
        </div>
        {!blogs && <div className="skeleton" style={{ height: 300 }} />}
        {blogs?.length === 0 && (
          <div className="empty" style={{ padding: 40, textAlign: "center" }}>
            No articles yet — check back soon.
          </div>
        )}
        <div className="grid grid-3">
          {(blogs || []).map((b) => (
            <Link key={b.id} to={`/blog/${b.slug}`} className="artist-card" data-testid={`blog-card-${b.slug}`}>
              <div className="artist-card-cover" style={{ background: `url(${b.cover_image || ""}) center/cover, linear-gradient(135deg, rgba(212,175,55,0.2), rgba(109,40,217,0.1))` }}>
                {!b.cover_image && <span style={{ fontSize: 64 }}>📝</span>}
              </div>
              <div className="artist-card-body">
                <div className="artist-card-name">{b.title}</div>
                {b.excerpt && <div className="artist-card-meta" style={{ marginTop: 4 }}>{b.excerpt.slice(0, 120)}</div>}
                <div className="artist-card-foot" style={{ marginTop: 8 }}>
                  <span className="text-muted fs-12">
                    {b.author || "BookTalent Editorial"} · {(b.created_at || "").slice(0, 10)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <Footer />
    </div>
  );
}
