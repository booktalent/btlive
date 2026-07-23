import React from "react";

/**
 * Iter 50 — ReviewStep
 * Step 4 of BookingFlow — read-only summary + T&Cs acknowledgements.
 * All state remains in BookingFlow; this file just renders.
 */
export default function ReviewStep({
  pkg,
  form,
  set,
  isOutstation,
  platformSettings,
  onBack,
  onNext,
}) {
  const showTravelRider =
    pkg && (pkg.travel_required || pkg.accommodation_required || pkg.local_transport_required || pkg.meals_required || pkg.travel_notes);
  const nextDisabled = (showTravelRider && !form.travel_ack) || (isOutstation && !form.outstation_ack);

  return (
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

      {showTravelRider && (
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
          {pkg.local_transport_required && <div className="flex justify-between mb-8"><span className="text-muted">Local transport</span><span>Required</span></div>}
          {pkg.meals_required && <div className="flex justify-between mb-8"><span className="text-muted">Meals</span><span>Required during stay</span></div>}
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
        {(form.special_instructions || "").trim() && (
          <div className="mt-12" data-testid="review-special-instructions">
            <div className="text-muted fs-11 mb-4" style={{ textTransform: "uppercase", letterSpacing: 1 }}>Special Instructions</div>
            <div className="fs-13" style={{ whiteSpace: "pre-line" }}>{form.special_instructions}</div>
          </div>
        )}
      </div>

      {isOutstation && (
        <div className="card card-pad mb-16" style={{ background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)" }} data-testid="review-outstation-notice">
          <div className="fw-700 text-gold fs-13 mb-8" style={{ textTransform: "uppercase", letterSpacing: 1 }}>📢 Outstation Booking</div>
          <div className="fs-13 mb-8" style={{ lineHeight: 1.5, whiteSpace: "pre-line" }}>
            {platformSettings.outstation_notice ||
              "Travel, accommodation, local transportation, meals, hospitality, and any other outstation expenses are NOT included in the Artist Package Fee. Please arrange these directly with the artist."}
          </div>
          <label className="flex items-center gap-8">
            <input type="checkbox" checked={!!form.outstation_ack} onChange={(e) => set("outstation_ack", e.target.checked)} data-testid="outstation-ack" />
            <span className="fs-12">I understand and agree to arrange all outstation logistics directly with the Artist.</span>
          </label>
        </div>
      )}

      <div className="flex justify-between mt-24">
        <button className="btn btn-ghost" onClick={onBack} data-testid="step4-back">← Back</button>
        <button className="btn btn-gold" onClick={onNext} disabled={nextDisabled} data-testid="step4-next">
          🔐 Proceed to Payment →
        </button>
      </div>
    </div>
  );
}
