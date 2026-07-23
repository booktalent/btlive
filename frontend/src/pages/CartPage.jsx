/**
 * CartPage — Booking cart review + checkout hand-off (Iter 52).
 *
 * Flow:
 * 1. Reads cart from useBookingCart (server-backed, survives login/refresh).
 * 2. Renders each artist row with editable event date, city, add-ons, and
 *    live per-artist subtotal.
 * 3. Aggregates: subtotal → Platform Fee 5% → GST 18% on the fee → grand total.
 * 4. "Continue to Booking" pushes to /book/:primary_id?cart=1 which the
 *    existing BookingFlow can consume via the useEventCart bridge. For a
 *    single-artist cart we just deep-link to the standard booking flow.
 */
import React, { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useBookingCart } from "../lib/useBookingCart";
import { useAuth } from "../lib/auth";
import { mediaUrl } from "../lib/api";
import Nav from "../components/Nav";
import Footer from "../components/Footer";

function formatINR(n) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default function CartPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { items, count, loading, remove, patch, clear, refresh } = useBookingCart();
  const [busyId, setBusyId] = useState(null);

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + Number(it.base_price || 0), 0);
    const platform_fee = Math.round(subtotal * 0.05);
    const gst = Math.round(platform_fee * 0.18);
    const grand = subtotal + platform_fee + gst;
    return { subtotal, platform_fee, gst, grand };
  }, [items]);

  const handleUpdate = async (id, patchBody) => {
    setBusyId(id);
    try { await patch(id, patchBody); } finally { setBusyId(null); }
  };

  const startCheckout = () => {
    if (!user) {
      // Preserve return-to intent so login sends the user right back here.
      try { sessionStorage.setItem("bt_post_login_redirect", "/cart"); } catch { /* ignore */ }
      nav("/login?next=/cart");
      return;
    }
    if (items.length === 0) return;
    // Deep-link the existing BookingFlow using the FIRST artist as the primary.
    // useEventCart on the BookingFlow will pick up the local cart mirror
    // via the `bt_event_cart_${id}` storage bridge for legacy compatibility,
    // OR just show the primary-artist checkout for single-item carts.
    const primary = items[0];
    nav(`/book/${primary.artist_id}?cart=1`);
  };

  return (
    <>
    <Nav />
    <div className="cart-page container" data-testid="cart-page">
      <div className="cart-head">
        <div>
          <div className="text-muted fs-11" style={{ letterSpacing: ".12em" }}>YOUR SELECTION</div>
          <h1 className="font-serif" style={{ fontSize: 36, margin: "6px 0" }}>Booking Cart</h1>
          <div className="text-muted fs-13">
            {count === 0 ? "Your cart is empty — pick an artist to get started."
              : `${count} artist${count === 1 ? "" : "s"} ready for booking · saved to your account`}
          </div>
        </div>
        {count > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={clear} data-testid="cart-clear">
            Clear cart
          </button>
        )}
      </div>

      {count === 0 ? (
        <div className="cart-empty" data-testid="cart-empty">
          <div className="cart-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          <h3 className="font-serif" style={{ fontSize: 24, marginTop: 12 }}>Nothing here yet</h3>
          <div className="text-muted fs-14 mt-8">Discover artists and hit "Book Now" — they'll appear here.</div>
          <div className="mt-16">
            <Link to="/search" className="btn btn-gold" data-testid="cart-empty-cta">Discover Artists</Link>
          </div>
        </div>
      ) : (
        <div className="cart-grid">
          <div className="cart-items">
            {items.map((it) => (
              <div key={it.id} className="cart-row" data-testid={`cart-row-${it.artist_id}`}>
                <div className="cart-row-photo">
                  {it.artist_photo
                    ? <img src={mediaUrl(it.artist_photo)} alt={it.artist_name || "artist"} />
                    : <div className="cart-row-photo-fallback">🎤</div>}
                </div>
                <div className="cart-row-body">
                  <div className="cart-row-top">
                    <div>
                      <Link to={`/artist/${it.artist_id}`} className="font-serif fs-18 fw-700" data-testid={`cart-artist-link-${it.artist_id}`}>
                        {it.artist_name || "Artist"}
                      </Link>
                      <div className="text-muted fs-12 mt-4">
                        {it.artist_category || "Performer"}{it.artist_city ? ` · ${it.artist_city}` : ""}
                        {it.package_name ? ` · ${it.package_name}` : ""}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => remove(it.id)}
                      disabled={busyId === it.id}
                      data-testid={`cart-remove-${it.id}`}
                    >Remove</button>
                  </div>

                  <div className="cart-row-meta">
                    <label>
                      <span className="fs-11 text-muted">Event date</span>
                      <input
                        type="date"
                        value={it.event_date || ""}
                        onChange={(e) => handleUpdate(it.id, { event_date: e.target.value })}
                        className="input input-sm"
                        data-testid={`cart-date-${it.id}`}
                      />
                    </label>
                    <label>
                      <span className="fs-11 text-muted">City</span>
                      <input
                        type="text"
                        placeholder="e.g. Mumbai"
                        value={it.event_city || ""}
                        onChange={(e) => handleUpdate(it.id, { event_city: e.target.value })}
                        className="input input-sm"
                        data-testid={`cart-city-${it.id}`}
                      />
                    </label>
                    <label>
                      <span className="fs-11 text-muted">Duration (hrs)</span>
                      <input
                        type="number" min="1" max="12" step="0.5"
                        value={it.duration_hours ?? 3}
                        onChange={(e) => handleUpdate(it.id, { duration_hours: Number(e.target.value) })}
                        className="input input-sm"
                        data-testid={`cart-duration-${it.id}`}
                      />
                    </label>
                  </div>

                  <div className="cart-row-bottom">
                    <div className="text-muted fs-12">Base price</div>
                    <div className="font-serif fs-18 fw-700 text-gold" data-testid={`cart-price-${it.id}`}>
                      {formatINR(it.base_price)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <aside className="cart-summary" data-testid="cart-summary">
            <div className="cart-summary-head">Order Summary</div>
            <div className="cart-summary-row"><span>Subtotal</span><b data-testid="cart-subtotal">{formatINR(totals.subtotal)}</b></div>
            <div className="cart-summary-row"><span>Platform Service Fee (5%)</span><b>{formatINR(totals.platform_fee)}</b></div>
            <div className="cart-summary-row"><span>GST on fee (18%)</span><b>{formatINR(totals.gst)}</b></div>
            <div className="cart-summary-row cart-summary-total">
              <span>Grand Total</span>
              <b className="text-gold" data-testid="cart-grand-total">{formatINR(totals.grand)}</b>
            </div>
            <div className="cart-summary-note text-muted fs-12">
              You only pay the Platform Fee + GST here — the artist fee is settled directly with the performer, keeping the platform lean.
            </div>
            <button
              className="btn btn-gold btn-lg cart-checkout-btn"
              onClick={startCheckout}
              disabled={loading}
              data-testid="cart-checkout-btn"
            >
              {user ? "Continue to Booking →" : "Login to Checkout →"}
            </button>
            <button
              className="btn btn-ghost btn-sm mt-8"
              onClick={refresh}
              data-testid="cart-refresh-btn"
              style={{ width: "100%" }}
            >Refresh Cart</button>
          </aside>
        </div>
      )}
    </div>
    <Footer />
    </>
  );
}
