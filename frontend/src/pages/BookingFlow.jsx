import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

const ADDONS = [
  { id: "dhol", label: "🥁 Dhol Player", price: 3500 },
  { id: "anchor", label: "🎙️ Anchor / Emcee", price: 5000 },
  { id: "photo", label: "📸 Photography", price: 4000 },
  { id: "extra-hour", label: "⏱️ Extra Hour", price: 8000 },
];

const TIME_SLOTS = ["2:00 PM", "4:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM", "11:00 PM"];

export default function BookingFlow() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [artist, setArtist] = useState(null);
  const [packages, setPackages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);

  const [form, setForm] = useState({
    package_id: params.get("pkg") || "",
    addons: [],
    event_date: "",
    event_time: "",
    event_type: "Wedding / Sangeet",
    venue: "",
    city: "",
    guests: "300-600",
    language_pref: "Hindi (Bollywood)",
    notes: "",
    customer_name: user ? `${user.first_name} ${user.last_name || ""}`.trim() : "",
    customer_phone: user?.phone || "",
    customer_email: user?.email || "",
    coupon_code: "",
  });
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [successData, setSuccessData] = useState(null);

  useEffect(() => {
    if (!user) { nav("/login"); return; }
    api.get(`/artists/${id}`).then((r) => {
      setArtist(r.data);
      setPackages(r.data.packages);
      if (!form.package_id && r.data.packages.length) {
        const pop = r.data.packages.find((p) => p.is_popular) || r.data.packages[0];
        setForm((f) => ({ ...f, package_id: pop.id }));
      }
    });
    // eslint-disable-next-line
  }, [id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleAddon = (a) => set("addons", form.addons.includes(a) ? form.addons.filter(x => x !== a) : [...form.addons, a]);

  const pkg = packages.find((p) => p.id === form.package_id);
  const addonsTotal = form.addons.reduce((s, a) => s + (ADDONS.find(x => x.id === a)?.price || 0), 0);
  const pkgPrice = pkg?.price || 0;
  const subtotal = pkgPrice + addonsTotal;
  const platformFee = Math.round(subtotal * 0.05);
  const gst = Math.round((subtotal + platformFee) * 0.18);
  const total = subtotal + platformFee + gst;
  const token = Math.round(total * 0.05);

  const submitBooking = async () => {
    setBusy(true);
    try {
      const r = await api.post("/bookings", { artist_id: id, ...form });
      const initR = await api.post("/payments/init", { booking_id: r.data.id, method: paymentMethod });
      const verR = await api.post("/payments/verify", { booking_id: r.data.id, payment_id: initR.data.payment_id, mock_otp: "123456" });
      setSuccessData({ booking: r.data, ref: verR.data.booking_ref });
      setStep(6);
    } catch (e) {
      toast(formatApiError(e), "error");
    }
    setBusy(false);
  };

  if (!artist) return (
    <div><Nav /><div className="loading"><div className="spinner" /></div></div>
  );

  return (
    <div data-testid="booking-flow-page">
      <Nav />
      <div className="container" style={{ paddingTop: 32, paddingBottom: 60 }}>
        {step < 6 && (
          <div className="steps" data-testid="booking-steps">
            {[1, 2, 3, 4, 5].map((n, i) => (
              <React.Fragment key={n}>
                <div className="step-node">
                  <div className={`step-circle ${step === n ? "active" : step > n ? "done" : ""}`}>{step > n ? "✓" : n}</div>
                </div>
                {i < 4 && <div className={`step-line ${step > n ? "done" : ""}`} />}
              </React.Fragment>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
          <div>
            {step === 1 && (
              <div className="card card-pad" data-testid="step-1">
                <h2 className="font-serif fs-20 fw-700 mb-8">Choose your Package</h2>
                <p className="text-muted fs-13 mb-20">Select the package that fits your event.</p>
                {packages.map((p) => (
                  <div
                    key={p.id} onClick={() => set("package_id", p.id)}
                    className={`pkg-card mb-12 ${form.package_id === p.id ? "selected" : ""}`}
                    data-testid={`pkg-opt-${p.id}`}
                  >
                    {p.is_popular && <span className="popular-tag">★ Most Popular</span>}
                    <div className="flex justify-between items-center" style={{ marginTop: p.is_popular ? 12 : 0 }}>
                      <div>
                        <div className="pkg-name" style={{ fontSize: 18 }}>{p.name}</div>
                        <div className="text-muted fs-12 mt-4">⏱ {p.duration} · {p.features.slice(0, 3).join(" · ")}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-gold font-serif" style={{ fontSize: 24, fontWeight: 700 }}>{fmtINRFull(p.price)}</div>
                        <div className="text-muted fs-11">per event</div>
                      </div>
                    </div>
                  </div>
                ))}
                <h3 className="fs-13 fw-600 mt-24 mb-12 text-muted" style={{ textTransform: "uppercase", letterSpacing: 1 }}>Optional Add-ons</h3>
                <div className="grid grid-2 gap-10">
                  {ADDONS.map((a) => (
                    <div
                      key={a.id} onClick={() => toggleAddon(a.id)}
                      className={`pkg-card ${form.addons.includes(a.id) ? "selected" : ""}`}
                      style={{ padding: 14 }}
                      data-testid={`addon-${a.id}`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="fw-600 fs-13">{a.label}</div>
                        <div className="text-gold fw-600 fs-13">+{fmtINRFull(a.price)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-24">
                  <div />
                  <button className="btn btn-gold" disabled={!form.package_id} onClick={() => setStep(2)} data-testid="step1-next">Continue to Schedule →</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="card card-pad" data-testid="step-2">
                <h2 className="font-serif fs-20 fw-700 mb-8">Pick your Date & Time</h2>
                <p className="text-muted fs-13 mb-20">Select an available date and preferred time.</p>
                <div className="field">
                  <div className="field-label">Event Date</div>
                  <input type="date" className="field-input" value={form.event_date} onChange={(e) => set("event_date", e.target.value)} data-testid="booking-date" />
                </div>
                {form.event_date && (
                  <div className="field">
                    <div className="field-label">Performance Start Time</div>
                    <div className="grid grid-4 gap-10">
                      {TIME_SLOTS.map((t) => (
                        <div
                          key={t}
                          onClick={() => set("event_time", t)}
                          className={`pkg-card text-center ${form.event_time === t ? "selected" : ""}`}
                          style={{ padding: 12, fontSize: 13, fontWeight: 600 }}
                          data-testid={`time-${t.replace(/[^0-9]/g, "")}`}
                        >
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-between mt-24">
                  <button className="btn btn-ghost" onClick={() => setStep(1)} data-testid="step2-back">← Back</button>
                  <button className="btn btn-gold" disabled={!form.event_date || !form.event_time} onClick={() => setStep(3)} data-testid="step2-next">Continue →</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="card card-pad" data-testid="step-3">
                <h2 className="font-serif fs-20 fw-700 mb-8">Tell us about your Event</h2>
                <p className="text-muted fs-13 mb-20">Help the artist prepare the perfect performance.</p>
                <div className="field-row">
                  <div className="field">
                    <div className="field-label">Your Full Name *</div>
                    <input className="field-input" value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} data-testid="booking-name" />
                  </div>
                  <div className="field">
                    <div className="field-label">Mobile Number *</div>
                    <input className="field-input" value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} data-testid="booking-phone" />
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <div className="field-label">Email *</div>
                    <input className="field-input" type="email" value={form.customer_email} onChange={(e) => set("customer_email", e.target.value)} data-testid="booking-email" />
                  </div>
                  <div className="field">
                    <div className="field-label">Event Type *</div>
                    <select className="field-input" value={form.event_type} onChange={(e) => set("event_type", e.target.value)} data-testid="booking-event-type">
                      <option>Wedding / Sangeet</option><option>Corporate Event</option><option>Birthday Celebration</option>
                      <option>Private Concert</option><option>College Fest</option>
                    </select>
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <div className="field-label">Venue *</div>
                    <input className="field-input" value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="e.g. Taj Lands End" data-testid="booking-venue" />
                  </div>
                  <div className="field">
                    <div className="field-label">City *</div>
                    <input className="field-input" value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Mumbai" data-testid="booking-city" />
                  </div>
                </div>
                <div className="field">
                  <div className="field-label">Special Instructions</div>
                  <textarea className="field-input" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Song dedications, special requests…" data-testid="booking-notes" />
                </div>
                <div className="field">
                  <div className="field-label">Coupon Code (optional)</div>
                  <input className="field-input" value={form.coupon_code} onChange={(e) => set("coupon_code", e.target.value.toUpperCase())} placeholder="e.g. WEDDING20" data-testid="booking-coupon" />
                </div>
                <div className="flex justify-between mt-24">
                  <button className="btn btn-ghost" onClick={() => setStep(2)} data-testid="step3-back">← Back</button>
                  <button className="btn btn-gold" disabled={!form.customer_name || !form.venue || !form.city} onClick={() => setStep(4)} data-testid="step3-next">Continue →</button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="card card-pad" data-testid="step-4">
                <h2 className="font-serif fs-20 fw-700 mb-8">Review & Confirm</h2>
                <p className="text-muted fs-13 mb-20">Double-check details before payment.</p>
                <div className="card card-pad mb-16">
                  <h3 className="fw-600 fs-13 mb-12 text-gold" style={{ textTransform: "uppercase" }}>Performance Package</h3>
                  <div className="flex justify-between mb-8"><span className="text-muted">Package</span><span>{pkg?.name}</span></div>
                  <div className="flex justify-between mb-8"><span className="text-muted">Duration</span><span>{pkg?.duration}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Add-ons</span><span>{form.addons.length || "None"}</span></div>
                </div>
                <div className="card card-pad mb-16">
                  <h3 className="fw-600 fs-13 mb-12 text-gold" style={{ textTransform: "uppercase" }}>Event Details</h3>
                  <div className="flex justify-between mb-8"><span className="text-muted">Date</span><span>{form.event_date} · {form.event_time}</span></div>
                  <div className="flex justify-between mb-8"><span className="text-muted">Venue</span><span>{form.venue}, {form.city}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Type</span><span>{form.event_type}</span></div>
                </div>
                <div className="flex justify-between mt-24">
                  <button className="btn btn-ghost" onClick={() => setStep(3)} data-testid="step4-back">← Back</button>
                  <button className="btn btn-gold" onClick={() => setStep(5)} data-testid="step4-next">🔐 Proceed to Payment →</button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="card card-pad" data-testid="step-5">
                <h2 className="font-serif fs-20 fw-700 mb-8">Secure Payment</h2>
                <p className="text-muted fs-13 mb-20">Pay your 5% booking token to confirm.</p>
                <div className="grid grid-4 gap-10 mb-20">
                  {[
                    { id: "card", label: "💳 Card" },
                    { id: "upi", label: "📲 UPI" },
                    { id: "netbanking", label: "🏦 Bank" },
                    { id: "wallet", label: "👛 Wallet" },
                  ].map((m) => (
                    <div
                      key={m.id} onClick={() => setPaymentMethod(m.id)}
                      className={`pkg-card text-center ${paymentMethod === m.id ? "selected" : ""}`}
                      style={{ padding: 14, fontWeight: 600 }}
                      data-testid={`pay-${m.id}`}
                    >{m.label}</div>
                  ))}
                </div>

                {paymentMethod === "card" && (
                  <div data-testid="card-form">
                    <div className="field">
                      <div className="field-label">Card Number (test)</div>
                      <input className="field-input font-mono" defaultValue="4242 4242 4242 4242" />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <div className="field-label">Expiry</div>
                        <input className="field-input font-mono" defaultValue="12/29" />
                      </div>
                      <div className="field">
                        <div className="field-label">CVV</div>
                        <input className="field-input font-mono" defaultValue="123" />
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ background: "var(--green-dim)", border: "1px solid var(--green-border)", borderRadius: 10, padding: 12, fontSize: 12, color: "var(--green)" }}>
                  🔒 Test mode: OTP <strong>123456</strong> will be auto-applied for verification.
                </div>

                <div className="flex justify-between mt-24">
                  <button className="btn btn-ghost" onClick={() => setStep(4)} data-testid="step5-back">← Back</button>
                  <button className="btn btn-gold btn-lg" disabled={busy} onClick={submitBooking} data-testid="pay-now-btn">
                    {busy ? "Processing…" : `🔐 Pay ${fmtINRFull(token)} to Confirm`}
                  </button>
                </div>
              </div>
            )}

            {step === 6 && successData && (
              <div className="card card-pad text-center" data-testid="step-success">
                <div style={{ fontSize: 72, marginBottom: 12 }}>✅</div>
                <h2 className="font-serif" style={{ fontSize: 40, fontWeight: 700, marginBottom: 8 }}>Booking Confirmed!</h2>
                <p className="text-muted mb-20">
                  Your booking with <strong>{artist.profile.stage_name}</strong> is officially confirmed.
                  The artist has been notified.
                </p>
                <div className="pill pill-gold mb-24" style={{ fontSize: 14, padding: "8px 16px" }} data-testid="booking-ref">
                  Booking Ref: {successData.ref}
                </div>
                <div className="card card-pad mb-20" style={{ textAlign: "left", maxWidth: 480, margin: "0 auto 20px" }}>
                  <div className="flex justify-between mb-8"><span className="text-muted">Artist</span><span>{artist.profile.stage_name}</span></div>
                  <div className="flex justify-between mb-8"><span className="text-muted">Package</span><span>{pkg?.name}</span></div>
                  <div className="flex justify-between mb-8"><span className="text-muted">Date</span><span>{form.event_date} · {form.event_time}</span></div>
                  <div className="flex justify-between mb-8"><span className="text-muted">Venue</span><span>{form.venue}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Token Paid</span><span className="text-green">{fmtINRFull(token)}</span></div>
                </div>
                <div className="flex gap-12 justify-center" style={{ flexWrap: "wrap" }}>
                  <button className="btn btn-gold" onClick={() => nav("/customer")} data-testid="success-go-dashboard">📊 Go to Dashboard</button>
                  <button className="btn btn-ghost" onClick={() => nav("/")} data-testid="success-go-home">🏠 Home</button>
                </div>
              </div>
            )}
          </div>

          {step < 6 && (
            <div data-testid="order-summary">
              <div className="card card-pad" style={{ position: "sticky", top: 90 }}>
                <div className="flex items-center gap-12 mb-16" style={{ padding: 8, background: "var(--glass)", borderRadius: 10 }}>
                  <div className="avatar avatar-lg" style={{ background: "linear-gradient(135deg, var(--purple), var(--gold))", width: 50, height: 50, fontSize: 24 }}>
                    {artist.profile.emoji || "🎤"}
                  </div>
                  <div>
                    <div className="fw-700 font-serif fs-16">{artist.profile.stage_name}</div>
                    <div className="text-muted fs-11">{artist.profile.category} · {artist.profile.city}</div>
                  </div>
                </div>
                <div className="divider" style={{ margin: "12px 0" }} />
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">Package fee</span><span>{fmtINRFull(pkgPrice)}</span></div>
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">Add-ons</span><span>{fmtINRFull(addonsTotal)}</span></div>
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">Platform Fee (5%)</span><span>{fmtINRFull(platformFee)}</span></div>
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">GST (18%)</span><span>{fmtINRFull(gst)}</span></div>
                <div className="divider" style={{ margin: "12px 0" }} />
                <div className="flex justify-between mb-12">
                  <span className="fw-700">Total</span>
                  <span className="fw-700 text-gold font-serif fs-18">{fmtINRFull(total)}</span>
                </div>
                <div style={{ background: "var(--gold-dim)", padding: 14, borderRadius: 10 }}>
                  <div className="text-muted fs-11 mb-4">🔐 Pay Now (5% Token)</div>
                  <div className="font-serif fs-20 fw-700 text-gold" data-testid="token-amount">{fmtINRFull(token)}</div>
                  <div className="text-muted fs-11 mt-4">Balance {fmtINRFull(total - token)} due before event</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
