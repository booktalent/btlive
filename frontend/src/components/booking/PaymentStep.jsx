import React from "react";
import { fmtINRFull } from "../../lib/api";

/**
 * Iter 47 — PaymentStep
 * Pure-render component for BookingFlow's Step 5 (Secure Payment).
 * All state stays in the parent — this file only encapsulates the UI so
 * batch-vs-single logic and the shared "5% + 18% GST" business rules don't
 * sprawl across BookingFlow's 1000+ lines of orchestration code.
 *
 * Props:
 *   paymentMethod, setPaymentMethod            — current payment choice
 *   paymentConfig                              — { razorpay_enabled: bool }
 *   busy                                       — disables Pay button
 *   token, cartPricing, isMultiEvent, cartItems — pricing display
 *   onBack, onSubmit                            — nav handlers
 */
export default function PaymentStep({
  paymentMethod,
  setPaymentMethod,
  paymentConfig,
  busy,
  token,
  cartPricing,
  isMultiEvent,
  cartItems,
  onBack,
  onSubmit,
}) {
  const amount = isMultiEvent ? cartPricing.token_amount : token;
  const gatewayLive = paymentConfig.razorpay_enabled;

  return (
    <div className="card card-pad" data-testid="step-5">
      <h2 className="font-serif fs-20 fw-700 mb-8">Secure Payment</h2>
      <p className="text-muted fs-13 mb-20">
        Pay your 5% booking token to confirm{isMultiEvent ? ` · ${cartItems.length} artists in this event` : ""}.
      </p>

      <div className="grid grid-3 gap-10 mb-20">
        {[
          { id: "card", label: "💳 Card" },
          { id: "upi", label: "📲 UPI" },
          { id: "netbanking", label: "🏦 Bank" },
        ].map((m) => (
          <div
            key={m.id}
            onClick={() => setPaymentMethod(m.id)}
            className={`pkg-card text-center ${paymentMethod === m.id ? "selected" : ""}`}
            style={{ padding: 14, fontWeight: 600 }}
            data-testid={`pay-${m.id}`}
          >
            {m.label}
          </div>
        ))}
      </div>

      {paymentMethod === "card" && !gatewayLive && (
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

      <div
        style={{
          background: gatewayLive ? "rgba(59,130,246,0.1)" : "var(--green-dim)",
          border: `1px solid ${gatewayLive ? "rgba(59,130,246,0.3)" : "var(--green-border)"}`,
          borderRadius: 10,
          padding: 12,
          fontSize: 12,
          color: gatewayLive ? "var(--blue)" : "var(--green)",
        }}
        data-testid="payment-gateway-banner"
      >
        {gatewayLive
          ? "🔒 Razorpay LIVE — clicking Pay will open the secure Razorpay checkout."
          : "🔒 Test mode: Mock gateway active (Razorpay keys not configured). OTP 123456 auto-applied."}
      </div>

      <div className="flex justify-between mt-24">
        <button className="btn btn-ghost" onClick={onBack} data-testid="step5-back">← Back</button>
        <button className="btn btn-gold btn-lg" disabled={busy} onClick={onSubmit} data-testid="pay-now-btn">
          {busy
            ? "Processing…"
            : `🔐 Pay ${fmtINRFull(amount)} ${gatewayLive ? "via Razorpay" : "to Confirm"}${isMultiEvent ? ` · ${cartItems.length} artists` : ""}`}
        </button>
      </div>
    </div>
  );
}
