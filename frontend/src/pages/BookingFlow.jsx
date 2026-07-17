import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Nav from "../components/Nav";
import api, { fmtINRFull, formatApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

/** Lazy-load Razorpay checkout JS once */
const loadRazorpay = () => new Promise((resolve) => {
  if (window.Razorpay) return resolve(true);
  const s = document.createElement("script");
  s.src = "https://checkout.razorpay.com/v1/checkout.js";
  s.onload = () => resolve(true);
  s.onerror = () => resolve(false);
  document.body.appendChild(s);
});

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
  const [artistAddons, setArtistAddons] = useState([]); // Sprint 3
  const [platformSettings, setPlatformSettings] = useState({});  // Outstation policy strings
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);

  const [form, setForm] = useState({
    package_id: params.get("pkg") || "",
    addons: [],
    addon_selections: [],  // Sprint 3: [{addon_id, quantity}]
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
  const [paymentConfig, setPaymentConfig] = useState({ razorpay_enabled: false });
  const [alternatives, setAlternatives] = useState(null);

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
    // Sprint 3 — load artist-defined add-ons
    api.get(`/artists/${id}/addons`).then((r) => {
      setArtistAddons(r.data || []);
      // Auto-select mandatory add-ons
      const mandatory = (r.data || []).filter((a) => a.is_mandatory).map((a) => ({ addon_id: a.id, quantity: 1 }));
      if (mandatory.length) setForm((f) => ({ ...f, addon_selections: mandatory }));
    }).catch(() => setArtistAddons([]));
    // Outstation policy strings — admin-editable via /admin/settings
    api.get("/settings/public").then((r) => setPlatformSettings(r.data || {})).catch(() => {});    api.get("/payments/config").then((r) => setPaymentConfig(r.data)).catch(() => {});
    // Fetch only when the artist/package `id` changes. Adding `form.package_id`
    // would refetch on every form key-stroke; adding `nav`/`user` would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleAddon = (a) => set("addons", form.addons.includes(a) ? form.addons.filter(x => x !== a) : [...form.addons, a]);

  // Iter 35 — Canonicalise cities before comparing so intra-region events
  // (Delhi/New Delhi/NCR, Mumbai/Bombay, Bengaluru/Bangalore, ...) don't
  // wrongly trigger the outstation gate. Uses the same alias table as the
  // backend, exposed via /settings/public.
  const canonicalCity = (name) => {
    const key = (name || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) return "";
    const table = platformSettings.city_aliases || {};
    for (const [canon, aliases] of Object.entries(table)) {
      if (canon.toLowerCase() === key) return canon.toLowerCase();
      if (Array.isArray(aliases) && aliases.some((a) => (a || "").toLowerCase() === key)) return canon.toLowerCase();
    }
    return key;
  };
  const isOutstation = !!(
    form.city &&
    artist?.profile?.city &&
    canonicalCity(form.city) !== canonicalCity(artist.profile.city)
  );

  // Sprint 3 — Artist-defined add-on helpers
  const isAddonSelected = (id) => form.addon_selections.some((x) => x.addon_id === id);
  const addonQty = (id) => form.addon_selections.find((x) => x.addon_id === id)?.quantity || 0;
  const toggleArtistAddon = (a) => {
    if (a.is_mandatory) return; // cannot deselect mandatory
    setForm((f) => ({
      ...f,
      addon_selections: isAddonSelected(a.id)
        ? f.addon_selections.filter((x) => x.addon_id !== a.id)
        : [...f.addon_selections, { addon_id: a.id, quantity: 1 }],
    }));
  };
  const setArtistAddonQty = (a, qty) => {
    const q = Math.max(1, Math.min(a.max_quantity || 1, Number(qty) || 1));
    setForm((f) => ({
      ...f,
      addon_selections: f.addon_selections.map((x) =>
        x.addon_id === a.id ? { ...x, quantity: q } : x,
      ),
    }));
  };

  const pkg = packages.find((p) => p.id === form.package_id);
  const addonsTotal = form.addons.reduce((s, a) => s + (ADDONS.find(x => x.id === a)?.price || 0), 0);
  // Sprint 3 — artist add-ons total (unit_price * qty + gst_pct)
  const artistAddonsTotal = form.addon_selections.reduce((s, sel) => {
    const a = artistAddons.find((x) => x.id === sel.addon_id);
    if (!a) return s;
    const sub = a.price * sel.quantity;
    const gst = sub * (a.gst_pct || 0) / 100;
    return s + sub + gst;
  }, 0);
  const pkgPrice = pkg?.price || 0;
  // ── BookTalent business model ─────────────────────────────────────
  // We only collect Platform Service Fee (5% of Artist Fee) + 18% GST on it.
  // The Artist Performance Fee is settled directly between Customer and Artist.
  const artistFee = pkgPrice + addonsTotal + artistAddonsTotal;  // paid directly to artist
  const platformFee = Math.round(artistFee * 0.05);    // BookTalent service charge
  const gst = Math.round(platformFee * 0.18);          // 18% on platform fee only
  const total = platformFee + gst;                      // amount payable to BookTalent
  const token = total;                                  // legacy var — full BT amount
  // Keep `subtotal` defined to avoid breakage in legacy display blocks
  const subtotal = artistFee;

  const submitBooking = async () => {
    setBusy(true);
    setAlternatives(null);
    try {
      // 1. Create booking
      let r;
      try {
        r = await api.post("/bookings", { artist_id: id, ...form });
      } catch (e) {
        const detail = e?.response?.data?.detail;
        if (typeof detail === "object" && detail?.alternatives) {
          setAlternatives({ message: detail.message, date: detail.date, list: detail.alternatives });
          setBusy(false);
          return;
        }
        throw e;
      }
      const booking = r.data;
      const initR = await api.post("/payments/init", { booking_id: booking.id, method: paymentMethod });

      if (initR.data.gateway === "razorpay") {
        // 3a. Real Razorpay checkout
        const loaded = await loadRazorpay();
        if (!loaded) {
          toast("Could not load payment gateway", "error");
          setBusy(false);
          return;
        }
        const rp = initR.data.razorpay;
        const options = {
          key: rp.key_id,
          amount: initR.data.amount_paise,
          currency: rp.currency,
          name: rp.name,
          description: rp.description,
          order_id: rp.order_id,
          prefill: rp.prefill,
          notes: rp.notes,
          theme: { color: "#D4AF37" },
          handler: async (resp) => {
            try {
              const verR = await api.post("/payments/verify", {
                booking_id: booking.id,
                payment_id: initR.data.payment_id,
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              });
              setSuccessData({ booking, ref: verR.data.booking_ref });
              setStep(6);
            } catch (e) {
              toast(formatApiError(e), "error");
            } finally {
              setBusy(false);
            }
          },
          modal: {
            ondismiss: () => {
              setBusy(false);
              toast("Payment cancelled", "error");
            },
          },
        };
        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", (response) => {
          setBusy(false);
          toast(`Payment failed: ${response?.error?.description || "unknown"}`, "error");
        });
        rzp.open();
        return; // verify will run inside handler
      }

      // 3b. Mock flow — auto-verify with OTP 123456
      const verR = await api.post("/payments/verify", {
        booking_id: booking.id,
        payment_id: initR.data.payment_id,
        mock_otp: "123456",
      });
      setSuccessData({ booking, ref: verR.data.booking_ref });
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

                {/* Sprint 3 — Artist-defined add-ons */}
                {artistAddons.length > 0 && (
                  <>
                    <h3 className="fs-13 fw-600 mt-24 mb-12 text-gold" style={{ textTransform: "uppercase", letterSpacing: 1 }}>🎁 Artist Add-ons</h3>
                    <div className="flex-col gap-10">
                      {artistAddons.map((a) => {
                        const selected = isAddonSelected(a.id);
                        return (
                          <div
                            key={a.id}
                            onClick={() => toggleArtistAddon(a)}
                            className={`pkg-card ${selected ? "selected" : ""} ${a.is_mandatory ? "popular" : ""}`}
                            style={{ padding: 14, cursor: a.is_mandatory ? "default" : "pointer" }}
                            data-testid={`artist-addon-${a.id}`}
                          >
                            {a.is_mandatory && <span className="popular-tag">★ Mandatory</span>}
                            <div className="flex justify-between items-center" style={{ marginTop: a.is_mandatory ? 12 : 0 }}>
                              <div style={{ flex: 1 }}>
                                <div className="fw-600 fs-14">{a.name}</div>
                                {a.description && <div className="text-muted fs-12">{a.description}</div>}
                                {a.gst_pct > 0 && <div className="text-muted fs-11">+{a.gst_pct}% GST</div>}
                              </div>
                              <div className="text-right">
                                <div className="text-gold fw-700 fs-15">+{fmtINRFull(a.price)}</div>
                                {selected && a.max_quantity > 1 && (
                                  <div className="flex items-center gap-8 mt-8" onClick={(e) => e.stopPropagation()}>
                                    <button className="btn btn-ghost btn-xs" onClick={() => setArtistAddonQty(a, addonQty(a.id) - 1)} data-testid={`artist-addon-qty-dec-${a.id}`}>−</button>
                                    <span className="fs-13 fw-600" data-testid={`artist-addon-qty-${a.id}`}>{addonQty(a.id)}</span>
                                    <button className="btn btn-ghost btn-xs" onClick={() => setArtistAddonQty(a, addonQty(a.id) + 1)} data-testid={`artist-addon-qty-inc-${a.id}`}>+</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

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

                {/* Outstation Business Rule — auto-shown when event city ≠ artist city (alias-aware) */}
                {isOutstation && (
                  <div
                    className="card card-pad mb-16"
                    style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)" }}
                    data-testid="outstation-notice"
                  >
                    <div className="flex gap-8" style={{ alignItems: "flex-start" }}>
                      <div style={{ fontSize: 24, lineHeight: 1 }}>📢</div>
                      <div style={{ flex: 1 }}>
                        <div className="fw-700 text-gold fs-13 mb-4" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                          Outstation Booking Notice
                        </div>
                        <div className="fs-13" style={{ lineHeight: 1.5 }}>
                          {(platformSettings.outstation_notice ||
                            "This artist is based in {artist_city} and your event is in {event_city}. Travel, accommodation, local transport, food, hospitality and any other outstation logistics are not included in the Artist Package Fee and will be arranged and paid directly by you (the Customer).")
                            .replace("{artist_city}", artist.profile.city)
                            .replace("{event_city}", form.city)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
                  <div className="flex justify-between mb-8"><span className="text-muted">Add-ons</span><span>{form.addons.length || "None"}</span></div>
                  {form.addon_selections.length > 0 && (
                    <div className="flex justify-between"><span className="text-muted">Artist add-ons</span><span data-testid="review-artist-addons">{form.addon_selections.length}</span></div>
                  )}
                </div>

                {/* Sprint 4 — Travel & Accommodation Rider */}
                {pkg && (pkg.travel_required || pkg.accommodation_required || pkg.local_transport_required || pkg.meals_required || pkg.travel_notes) && (
                  <div className="card card-pad mb-16" data-testid="review-travel-block">
                    <h3 className="fw-600 fs-13 mb-12 text-gold" style={{ textTransform: "uppercase" }}>✈️ Travel & Accommodation Rider</h3>
                    <div className="text-muted fs-11 mb-12">Borne by you (not billed by BookTalent). Will be captured in the signed agreement.</div>
                    {pkg.travel_required && (
                      <div className="flex justify-between mb-8"><span className="text-muted">Flight / Travel</span><span>{pkg.flight_class || "economy"} · {pkg.team_size || 1} person(s)</span></div>
                    )}
                    {pkg.accommodation_required && (
                      <div className="flex justify-between mb-8"><span className="text-muted">Accommodation</span><span>{pkg.hotel_category || "3-star"} · {pkg.team_size || 1} person(s)</span></div>
                    )}
                    {pkg.arrival_buffer_days ? (
                      <div className="flex justify-between mb-8"><span className="text-muted">Arrival buffer</span><span>{pkg.arrival_buffer_days} day(s) prior</span></div>
                    ) : null}
                    {pkg.local_transport_required && (
                      <div className="flex justify-between mb-8"><span className="text-muted">Local transport</span><span>Required</span></div>
                    )}
                    {pkg.meals_required && (
                      <div className="flex justify-between mb-8"><span className="text-muted">Meals</span><span>Required during stay</span></div>
                    )}
                    {pkg.travel_notes && (
                      <div className="mt-8">
                        <div className="text-muted fs-12 mb-4">Additional notes</div>
                        <div className="fs-13">{pkg.travel_notes}</div>
                      </div>
                    )}

                    <label className="flex items-center gap-8 mt-12" data-testid="travel-ack">
                      <input type="checkbox" checked={!!form.travel_ack} onChange={(e) => set("travel_ack", e.target.checked)} data-testid="travel-ack-checkbox" />
                      <span className="fs-12">I acknowledge and agree to bear these travel & accommodation costs.</span>
                    </label>
                  </div>
                )}
                <div className="card card-pad mb-16">
                  <h3 className="fw-600 fs-13 mb-12 text-gold" style={{ textTransform: "uppercase" }}>Event Details</h3>
                  <div className="flex justify-between mb-8"><span className="text-muted">Date</span><span>{form.event_date} · {form.event_time}</span></div>
                  <div className="flex justify-between mb-8"><span className="text-muted">Venue</span><span>{form.venue}, {form.city}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Type</span><span>{form.event_type}</span></div>
                </div>

                {/* Outstation Notice + acknowledgement — always required when cities differ (alias-aware) */}
                {isOutstation && (
                  <div
                    className="card card-pad mb-16"
                    style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)" }}
                    data-testid="review-outstation-notice"
                  >
                    <div className="fw-700 text-gold fs-13 mb-8" style={{ textTransform: "uppercase", letterSpacing: 1 }}>
                      📢 Outstation Booking
                    </div>
                    <div className="fs-13 mb-8" style={{ lineHeight: 1.5 }}>
                      {(platformSettings.outstation_notice ||
                        "This artist is based in {artist_city} and your event is in {event_city}. Travel, accommodation, local transport, food, hospitality and any other outstation logistics are not included in the Artist Package Fee and will be arranged and paid directly by you (the Customer).")
                        .replace("{artist_city}", artist.profile.city)
                        .replace("{event_city}", form.city)}
                    </div>
                    <label className="flex items-center gap-8">
                      <input type="checkbox" checked={!!form.outstation_ack} onChange={(e) => set("outstation_ack", e.target.checked)} data-testid="outstation-ack" />
                      <span className="fs-12">I understand and agree to arrange all outstation logistics directly with the Artist.</span>
                    </label>
                  </div>
                )}

                <div className="flex justify-between mt-24">
                  <button className="btn btn-ghost" onClick={() => setStep(3)} data-testid="step4-back">← Back</button>
                  <button
                    className="btn btn-gold"
                    onClick={() => setStep(5)}
                    disabled={
                      (pkg && (pkg.travel_required || pkg.accommodation_required || pkg.local_transport_required || pkg.meals_required || pkg.travel_notes) && !form.travel_ack) ||
                      (isOutstation && !form.outstation_ack)
                    }
                    data-testid="step4-next"
                  >🔐 Proceed to Payment →</button>
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

                {paymentMethod === "card" && !paymentConfig.razorpay_enabled && (
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

                <div style={{ background: paymentConfig.razorpay_enabled ? "rgba(59,130,246,0.1)" : "var(--green-dim)", border: `1px solid ${paymentConfig.razorpay_enabled ? "rgba(59,130,246,0.3)" : "var(--green-border)"}`, borderRadius: 10, padding: 12, fontSize: 12, color: paymentConfig.razorpay_enabled ? "var(--blue)" : "var(--green)" }} data-testid="payment-gateway-banner">
                  {paymentConfig.razorpay_enabled
                    ? "🔒 Razorpay LIVE — clicking Pay will open the secure Razorpay checkout."
                    : "🔒 Test mode: Mock gateway active (Razorpay keys not configured). OTP 123456 auto-applied."}
                </div>

                <div className="flex justify-between mt-24">
                  <button className="btn btn-ghost" onClick={() => setStep(4)} data-testid="step5-back">← Back</button>
                  <button className="btn btn-gold btn-lg" disabled={busy} onClick={submitBooking} data-testid="pay-now-btn">
                    {busy ? "Processing…" : `🔐 Pay ${fmtINRFull(token)} ${paymentConfig.razorpay_enabled ? "via Razorpay" : "to Confirm"}`}
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
                  <div className="flex justify-between mb-8"><span className="text-muted">Artist Performance Fee</span><span>{fmtINRFull(artistFee)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">Paid to BookTalent</span><span className="text-green">{fmtINRFull(total)}</span></div>
                  <div className="text-muted fs-11 mt-12" style={{ marginTop: 12, lineHeight: 1.4 }}>
                    ℹ️ The Artist Performance Fee of <b>{fmtINRFull(artistFee)}</b> will be settled directly with the artist as per your signed agreement.
                  </div>
                </div>
                <div className="flex gap-12 justify-center" style={{ flexWrap: "wrap" }}>
                  <button className="btn btn-gold" onClick={() => nav("/customer")} data-testid="success-go-dashboard">📊 Go to Dashboard</button>
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      const tok = localStorage.getItem("bt_token");
                      const r = await fetch(`${api.defaults.baseURL}/bookings/${successData.booking.id}/invoice`, { headers: { Authorization: `Bearer ${tok}` } });
                      const blob = await r.blob();
                      const a = document.createElement("a");
                      a.href = window.URL.createObjectURL(blob);
                      a.download = `invoice_${successData.ref}.pdf`;
                      a.click();
                    }}
                    data-testid="success-dl-invoice"
                  >🧾 Download Invoice</button>
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
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">Artist Performance Fee</span><span>{fmtINRFull(artistFee)}</span></div>
                {addonsTotal > 0 && (
                  <div className="flex justify-between mb-8 fs-11" style={{ marginLeft: 12 }}><span className="text-muted">  Package {fmtINRFull(pkgPrice)} + basic add-ons {fmtINRFull(addonsTotal)}</span></div>
                )}
                {artistAddonsTotal > 0 && (
                  <div className="flex justify-between mb-8 fs-11" style={{ marginLeft: 12 }} data-testid="summary-artist-addons"><span className="text-muted">  + Artist add-ons {fmtINRFull(Math.round(artistAddonsTotal))}</span></div>
                )}
                <div className="divider" style={{ margin: "8px 0" }} />
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">Platform Service Fee (5%)</span><span>{fmtINRFull(platformFee)}</span></div>
                <div className="flex justify-between mb-8 fs-13"><span className="text-muted">GST (18% on Platform Fee)</span><span>{fmtINRFull(gst)}</span></div>
                <div className="divider" style={{ margin: "12px 0" }} />
                <div className="flex justify-between mb-12">
                  <span className="fw-700">Amount Payable to BookTalent</span>
                  <span className="fw-700 text-gold font-serif fs-18" data-testid="bt-amount">{fmtINRFull(total)}</span>
                </div>
                <div style={{ background: "var(--gold-dim)", padding: 14, borderRadius: 10 }}>
                  <div className="text-muted fs-11 mb-4">🔐 Pay Now to BookTalent</div>
                  <div className="font-serif fs-20 fw-700 text-gold" data-testid="token-amount">{fmtINRFull(total)}</div>
                  <div className="text-muted fs-11 mt-8" style={{ marginTop: 8, lineHeight: 1.4 }}>
                    ℹ️ Remaining Artist Performance Fee of <b>{fmtINRFull(artistFee)}</b> will be settled directly between the Customer and the Artist as per the signed agreement.
                  </div>
                </div>

                {/* Fee-Inclusion Note — always visible under the totals */}
                <div
                  className="text-muted fs-11 mt-12"
                  style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.03)", lineHeight: 1.5 }}
                  data-testid="booking-fee-note"
                >
                  {platformSettings.booking_fee_note ||
                    "Travel, accommodation, local transport, food, hospitality and any other outstation expenses are NOT included in the Artist Package Fee. These expenses will be discussed and managed directly between the Customer and the Artist."}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {alternatives && (
        <div className="modal-bg" onClick={() => setAlternatives(null)} data-testid="alternatives-modal">
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">📅 Date Not Available</div>
            <div className="modal-sub">{alternatives.message} on {alternatives.date}. Here are some great alternatives:</div>
            {alternatives.list.length === 0 ? (
              <div className="empty"><div className="empty-icon">🔍</div><div className="empty-title">No alternatives found</div><p className="fs-13">Try picking a different date.</p></div>
            ) : (
              <div className="flex-col gap-12">
                {alternatives.list.map((a) => (
                  <div
                    key={a.user_id} className="card card-pad flex items-center gap-12"
                    onClick={() => { window.location.href = `/artist/${a.user_id}`; }}
                    style={{ cursor: "pointer" }}
                    data-testid={`alt-${a.user_id}`}
                  >
                    <div className="avatar avatar-lg" style={{ background: "linear-gradient(135deg, var(--purple), var(--gold))", width: 48, height: 48, fontSize: 22 }}>{a.emoji || "🎤"}</div>
                    <div style={{ flex: 1 }}>
                      <div className="fw-700 font-serif">{a.stage_name}</div>
                      <div className="text-muted fs-12">{a.category} · 📍 {a.city}</div>
                    </div>
                    <div className="text-gold fs-13 fw-700">★ {(a.rating_avg || 0).toFixed(1)}</div>
                  </div>
                ))}
              </div>
            )}
            <button className="btn btn-ghost btn-block mt-16" onClick={() => { setAlternatives(null); setStep(2); }} data-testid="alt-pick-different-date">Pick a Different Date</button>
          </div>
        </div>
      )}
    </div>
  );
}
