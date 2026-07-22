import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";

/**
 * Compact month-grid calendar showing artist's live availability.
 * - Blocked / booked dates are shown red-tinted and non-clickable.
 * - Past dates are dimmed & non-clickable.
 * - Free future dates are clickable; onPick(dateStr) fires with "YYYY-MM-DD".
 * - Prev/next month navigation with a 3-month look-ahead lazy fetch.
 */
export default function AvailabilityCalendar({ artistUserId, onPick, selected = null, basePrice = null, editable = false, onEdit = null }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [blocked, setBlocked] = useState(new Set());
  const [premium, setPremium] = useState({}); // { "2026-08-15": {multiplier, label} }
  const [loading, setLoading] = useState(false);

  const monthLabel = month.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  // Fetch blocked dates for the current month +/- 1 to make prev/next feel instant.
  useEffect(() => {
    if (!artistUserId) return;
    setLoading(true);
    const from = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 2, 0);
    const fmt = (d) => d.toISOString().split("T")[0];
    api.get(`/artists/${artistUserId}/availability?from_date=${fmt(from)}&to_date=${fmt(to)}`)
      .then((r) => {
        setBlocked(new Set(r.data?.blocked_dates || []));
        const pmap = {};
        (r.data?.premium_dates || []).forEach((p) => { pmap[p.date] = { multiplier: p.multiplier, label: p.label }; });
        setPremium(pmap);
      })
      .catch(() => { setBlocked(new Set()); setPremium({}); })
      .finally(() => setLoading(false));
  }, [artistUserId, month]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lastDate = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const leading = first.getDay(); // 0 = Sunday
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= lastDate; d++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    return cells;
  }, [month]);

  const step = (delta) => {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  };

  const fmtDate = (d) => d.toISOString().split("T")[0];

  return (
    <div className="avail-cal card card-pad" data-testid="availability-calendar">
      <div className="avail-cal-head">
        <button type="button" onClick={() => step(-1)} className="avail-cal-nav" aria-label="Previous month" data-testid="cal-prev">‹</button>
        <div className="avail-cal-title">{monthLabel}</div>
        <button type="button" onClick={() => step(1)} className="avail-cal-nav" aria-label="Next month" data-testid="cal-next">›</button>
      </div>
      <div className="avail-cal-legend">
        <span><i className="dot dot-free" /> Free</span>
        <span><i className="dot dot-premium" /> Premium</span>
        <span><i className="dot dot-blocked" /> Booked / Blocked</span>
        <span><i className="dot dot-selected" /> Selected</span>
      </div>
      <div className="avail-cal-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`h-${i}`} className="avail-cal-h">{d}</div>
        ))}
        {days.map((d, i) => {
          if (!d) return <div key={`e-${i}`} className="avail-cal-cell empty" />;
          const dateStr = fmtDate(d);
          const past = d < today;
          const isBlocked = blocked.has(dateStr);
          const isPremium = !!premium[dateStr];
          const isSelected = selected === dateStr;
          const disabled = past || isBlocked;
          const cls = ["avail-cal-cell"];
          if (past) cls.push("past");
          if (isBlocked) cls.push("blocked");
          if (isPremium && !isBlocked && !past) cls.push("premium");
          if (isSelected) cls.push("selected");
          if (!disabled && !isPremium) cls.push("free");
          let title = "Available";
          if (isBlocked) title = "Artist is unavailable on this date";
          else if (past) title = "Past date";
          else if (isPremium) {
            const p = premium[dateStr];
            const priceHint = basePrice ? ` · ~${Math.round(basePrice * p.multiplier).toLocaleString("en-IN")}` : "";
            title = `${p.label} rate: ${p.multiplier}× base price${priceHint}`;
          }
          return (
            <button
              key={dateStr}
              type="button"
              className={cls.join(" ")}
              disabled={disabled && !editable}
              onClick={() => {
                if (editable && onEdit) return onEdit(dateStr, { isBlocked, isPremium, premium: premium[dateStr] });
                if (!disabled && onPick) onPick(dateStr);
              }}
              data-testid={`cal-day-${dateStr}`}
              title={editable ? "Click to edit this date" : title}
            >
              {d.getDate()}
              {isPremium && !isBlocked && !past && (
                <span className="avail-cal-premium-mark" aria-hidden>{premium[dateStr].multiplier}×</span>
              )}
            </button>
          );
        })}
      </div>
      {loading && <div className="avail-cal-loading">Loading availability…</div>}
    </div>
  );
}
