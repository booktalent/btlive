import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import SEO, { buildBreadcrumb } from "../components/SEO";
import api from "../lib/api";

/**
 * /page/:slug — Renders any CMS page created from the Admin Panel.
 * SEO: dynamic title/desc/keywords/OG + WebPage & BreadcrumbList JSON-LD.
 */
export default function CmsPage() {
  const { slug } = useParams();
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setPage(null);
    setError(null);
    api.get(`/cms/pages/${slug}`)
      .then((r) => setPage(r.data))
      .catch((e) => setError(e?.response?.status === 404 ? "Not Found" : "Failed to load"));
  }, [slug]);

  if (error === "Not Found") {
    return (
      <div>
        <SEO title="Page Not Found" noindex path={`/page/${slug}`} />
        <Nav />
        <section className="section container" style={{ minHeight: "60vh", textAlign: "center", paddingTop: 80 }}>
          <div style={{ fontSize: 72 }}>📄</div>
          <h1 style={{ fontSize: 36 }}>Page Not Found</h1>
          <p className="text-muted mb-20">The page you're looking for doesn't exist or has been unpublished.</p>
          <Link to="/" className="btn btn-gold" data-testid="cms-back-home">← Back to Home</Link>
        </section>
        <Footer />
      </div>
    );
  }

  const title = page?.seo_title || page?.title || slug;
  const desc = page?.meta_description || page?.title || "";
  let extraLd = null;
  if (page?.schema_json) {
    try { extraLd = JSON.parse(page.schema_json); } catch (_) { extraLd = null; }
  }

  return (
    <div data-testid={`cms-page-${slug}`}>
      <SEO
        title={title}
        description={desc}
        keywords={page?.seo_keywords || ""}
        image={page?.og_image || undefined}
        canonical={page?.canonical || undefined}
        path={`/page/${slug}`}
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: title,
            description: desc,
            url: `https://booktalent.com/page/${slug}`,
          },
          buildBreadcrumb([
            { name: "Home", url: "/" },
            { name: title, url: `/page/${slug}` },
          ]),
          ...(extraLd ? [extraLd] : []),
        ]}
      />
      <Nav />
      <section className="section container" style={{ paddingTop: 60, minHeight: "60vh" }}>
        <div className="cms-content">
          {!page ? (
            <div className="skeleton" style={{ height: 400 }} />
          ) : (
            <>
              <h1 style={{ fontSize: 42, marginBottom: 12 }} data-testid="cms-title">{page.title}</h1>
              {page.updated_at && (
                <div className="text-muted fs-12 mb-24" data-testid="cms-updated">
                  Last updated: {String(page.updated_at).slice(0, 10)}
                </div>
              )}
              <div
                className="cms-body"
                data-testid="cms-body"
                dangerouslySetInnerHTML={{ __html: page.body_html || "" }}
              />
            </>
          )}
        </div>
      </section>
      <Footer />
    </div>
  );
}
