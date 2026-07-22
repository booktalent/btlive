import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";

/**
 * Compact month-grid calendar showing artist's live availability.
 * - Blocked / booked dates are shown red-tinted and non-clickable.
 * - Past dates are dimmed & non-clickable.
 * - Free future dates are clickable; onPick(dateStr) fires with "YYYY-MM-DD".
 * - Prev/next month navigation with a 3-month look-ahead lazy fetch.
 */
export default function AvailabilityCalendar({ artistUserId, onPick, selected = null }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [blocked, setBlocked] = useState(new Set());
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
      .then((r) => setBlocked(new Set(r.data?.blocked_dates || [])))
      .catch(() => setBlocked(new Set()))
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
          const isSelected = selected === dateStr;
          const disabled = past || isBlocked;
          const cls = ["avail-cal-cell"];
          if (past) cls.push("past");
          if (isBlocked) cls.push("blocked");
          if (isSelected) cls.push("selected");
          if (!disabled) cls.push("free");
          return (
            <button
              key={dateStr}
              type="button"
              className={cls.join(" ")}
              disabled={disabled}
              onClick={() => !disabled && onPick && onPick(dateStr)}
              data-testid={`cal-day-${dateStr}`}
              title={isBlocked ? "Artist is unavailable on this date" : past ? "Past date" : "Available"}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      {loading && <div className="avail-cal-loading">Loading availability…</div>}
    </div>
  );
}
