/**
 * BookingDetail — canonical booking detail view (Iter 86, Sec 32/37/40).
 *
 * Anyone with visibility into the booking (customer, artist, assigned
 * manager, agency, admin) can open this page. It shows the header +
 * embedded PaymentTimeline widget with inline "Mark Paid" gated to
 * admin/manager only (canEdit prop on the widget).
 */
import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Nav from "../components/Nav";
import api, { formatApiError as fmt } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { PaymentTimeline } from "../components/PaymentPayoutWidgets";

const money = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const STATUS_TINT = {
  confirmed: "green", completed: "green", reviewed: "green",
  pending_artist: "gold", pending_payment: "gold", started: "gold",
  rejected: "red", cancelled: "red", auto_expired: "red",
};

export default function BookingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [booking, setBooking] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);

  const canEditPayments = ["admin", "manager"].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/bookings/${id}`);
      // Different endpoints return {booking:{}} or a raw doc.
      setBooking(r.data.booking || r.data);
      try {
        const p = await api.get(`/bookings/${id}/payouts`);
        setPayouts(p.data.items || []);
      } catch { /* payouts list is optional */ }
    } catch (e) { toast(fmt(e), "error"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (loading) {
    return (
      <div>
        <Nav />
        <div className="pad-24" data-testid="bd-loading">Loading booking…</div>
      </div>
    );
  }
  if (!booking) {
    return (
      <div>
        <Nav />
        <div className="pad-24" data-testid="bd-not-found">
          Booking not found or you don't have access.
          <div className="mt-16">
            <Link to="/" className="btn btn-ghost btn-sm">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  const pricing = booking.pricing || {};
  const tint = STATUS_TINT[booking.status] || "gold";

  return (
    <div>
      <Nav />
      <div className="pad-24" data-testid="booking-detail" style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex-between mb-16" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="text-muted fs-12" style={{ letterSpacing: ".14em", textTransform: "uppercase" }}>
              Booking Reference
            </div>
            <h1 className="font-serif fs-28 fw-700 text-gold" data-testid="bd-ref">
              {booking.ref || booking.id}
            </h1>
            <div className="text-muted fs-13 mt-4">
              {booking.event_type} · {booking.event_date} {booking.event_time && `· ${booking.event_time}`}
            </div>
          </div>
          <div className="flex gap-8" style={{ alignItems: "center" }}>
            <span className={`pill pill-${tint}`} data-testid="bd-status">{booking.status}</span>
            {booking.artist_payout_status && (
              <span
                className={`pill pill-${booking.artist_payout_status === "paid" ? "green" : "gold"}`}
                data-testid="bd-payout-status"
              >
                Payout: {booking.artist_payout_status}
              </span>
            )}
          </div>
        </div>

        {/* ── Summary card ───────────────────────────────────────── */}
        <div className="grid grid-2 gap-16 mb-16">
          <div className="card card-pad" data-testid="bd-summary-card">
            <h3 className="fw-700 mb-8">Event</h3>
            <div className="fs-13 text-muted">Venue</div>
            <div className="mb-8">{booking.venue || "—"}, {booking.city || ""}</div>
            <div className="fs-13 text-muted">Customer</div>
            <div className="mb-8">{booking.customer_name || "—"}</div>
            {booking.customer_email && (
              <>
                <div className="fs-13 text-muted">Email</div>
                <div className="mb-8">{booking.customer_email}</div>
              </>
            )}
            {booking.special_instructions && (
              <>
                <div className="fs-13 text-muted mt-8">Special Instructions</div>
                <div className="fs-13" style={{ whiteSpace: "pre-wrap" }}>
                  {booking.special_instructions}
                </div>
              </>
            )}
          </div>
          <div className="card card-pad" data-testid="bd-pricing-card">
            <h3 className="fw-700 mb-8">Pricing</h3>
            <div className="flex-between fs-13"><span>Package Fee</span><span>₹{money(pricing.package_fee || pricing.base || 0)}</span></div>
            <div className="flex-between fs-13"><span>Add-ons</span><span>₹{money(pricing.addons_total || 0)}</span></div>
            <div className="flex-between fs-13"><span>Platform Fee</span><span>₹{money(pricing.platform_fee || 0)}</span></div>
            <div className="flex-between fs-13"><span>GST</span><span>₹{money(pricing.gst || 0)}</span></div>
            {pricing.coupon_discount ? (
              <div className="flex-between fs-13 text-green">
                <span>Coupon Discount</span><span>−₹{money(pricing.coupon_discount)}</span>
              </div>
            ) : null}
            <div className="flex-between mt-8 fw-700 fs-16" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <span>Total</span>
              <span className="text-gold" data-testid="bd-total">₹{money(pricing.total)}</span>
            </div>
            {pricing.artist_payable ? (
              <div className="flex-between mt-4 fs-13 text-muted">
                <span>Artist Payable</span><span>₹{money(pricing.artist_payable)}</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Payment Timeline ──────────────────────────────────── */}
        <div className="mb-16">
          <PaymentTimeline bookingId={id} canEdit={canEditPayments} />
        </div>

        {/* ── Payout Ledger (admin/manager/agency/artist only) ──── */}
        {payouts.length > 0 && (
          <div className="card card-pad mb-16" data-testid="bd-payout-ledger">
            <h3 className="fw-700 mb-8">Payout Ledger</h3>
            <table className="table w-full fs-13">
              <thead>
                <tr><th>Date</th><th>Amount</th><th>Method</th><th>UTR</th><th>By</th></tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} data-testid={`bd-payout-${p.id}`}>
                    <td>{(p.paid_on || p.created_at || "").slice(0, 10)}</td>
                    <td className="text-gold">₹{money(p.amount)}</td>
                    <td>{(p.method || "").toUpperCase()}</td>
                    <td className="font-mono fs-11">{p.utr}</td>
                    <td className="text-muted fs-11">{p.paid_by_email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-8">
          <Link to={user?.role === "admin" ? "/admin" : user?.role === "manager" ? "/manager" : "/customer"}
                className="btn btn-ghost btn-sm" data-testid="bd-back">← Back to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
