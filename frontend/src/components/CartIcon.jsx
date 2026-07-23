/**
 * CartIcon — global header cart badge (Iter 52).
 *
 * Renders a small shopping-bag icon with a live item-count badge. Clicking it
 * navigates to /cart. Uses a lightweight event-bus subscription so it updates
 * across the app whenever anyone adds/removes items (no context needed).
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { useBookingCart } from "../lib/useBookingCart";

export default function CartIcon() {
  const nav = useNavigate();
  const { count } = useBookingCart();

  return (
    <button
      onClick={() => nav("/cart")}
      className="cart-icon-btn"
      data-testid="cart-icon"
      aria-label={`Booking cart (${count} artist${count === 1 ? "" : "s"})`}
      title="Booking cart"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      {count > 0 && (
        <span className="cart-badge" data-testid="cart-badge">{count}</span>
      )}
    </button>
  );
}
