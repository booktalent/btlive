import React, { useEffect, useMemo, useState } from "react";
import api from "../lib/api";

/**
 * Compact month-grid calendar showing artist's live availability.
 * - Blocked / booked dates are shown red-tinted and non-clickable.
 * - Past dates are dimmed & non-clickable.
 * - Free future dates are clickable; onPick(dateStr) fires with "YYYY-MM-DD".
 * - Prev/next month navigation with a 3-month look-ahead lazy fetch.
 */
export default function AvailabilityCalendar({ artistUserId, onPick, selected = null, basePrice = null, editable = false, onEdit = null, onBulkEdit = null, onWeekendPreset = null }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [blocked, setBlocked] = useState(new Set());
  const [premium, setPremium] = useState({});
  const [loading, setLoading] = useState(false);
  // Bulk-select state — Shift+click extends range from lastPicked to current
  const [bulkSelection, setBulkSelection] = useState(new Set());
  const [lastPicked, setLastPicked] = useState(null);
  const bulkMode = editable && !!onBulkEdit;
  // Long-press timer for touch — hold ~500ms to start bulk selection
  const pressTimer = React.useRef(null);
  const startLongPress = (dateStr) => {
    if (!editable) return;
    pressTimer.current = setTimeout(() => {
      setBulkSelection(new Set([dateStr]));
      setLastPicked(dateStr);
      // Haptic feedback on supported devices
      if (navigator.vibrate) navigator.vibrate(30);
    }, 450);
  };
  const cancelLongPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

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
      {bulkMode && (
        <div className="avail-cal-toolbar">
          <button
            type="button"
            className={`avail-cal-toggle ${bulkSelection.size > 0 ? "active" : ""}`}
            onClick={() => {
              if (bulkSelection.size > 0) setBulkSelection(new Set());
              else if (lastPicked) setBulkSelection(new Set([lastPicked]));
              else {
                // Start with today so mobile users get instant feedback
                const t = today.toISOString().split("T")[0];
                setBulkSelection(new Set([t]));
                setLastPicked(t);
              }
            }}
            data-testid="cal-select-mode"
          >
            {bulkSelection.size > 0 ? `✕ Exit select (${bulkSelection.size})` : "☑ Select mode"}
          </button>
          {onWeekendPreset && (
            <button
              type="button"
              className="btn btn-gold btn-xs"
              onClick={onWeekendPreset}
              data-testid="cal-weekend-preset"
              title="Apply premium rate to every Sat & Sun for the next 3 months"
            >
              💎 Weekend preset (3 mo)
            </button>
          )}
        </div>
      )}
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
          const isToday = d.getTime() === today.getTime();
          const isBlocked = blocked.has(dateStr);
          const isPremium = !!premium[dateStr];
          const isSelected = selected === dateStr;
          const disabled = past || isBlocked;
          const cls = ["avail-cal-cell"];
          if (past) cls.push("past");
          if (isToday) cls.push("today");
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
              className={cls.join(" ") + (bulkSelection.has(dateStr) ? " bulk-picked" : "")}
              disabled={disabled && !editable}
              onClick={(e) => {
                if (editable && (e.shiftKey || e.ctrlKey || e.metaKey) && lastPicked) {
                  // Shift+click: extend range from lastPicked to current
                  const from = lastPicked < dateStr ? lastPicked : dateStr;
                  const to = lastPicked < dateStr ? dateStr : lastPicked;
                  const range = new Set(bulkSelection);
                  const cur = new Date(from);
                  const end = new Date(to);
                  while (cur <= end) {
                    range.add(cur.toISOString().split("T")[0]);
                    cur.setDate(cur.getDate() + 1);
                  }
                  setBulkSelection(range);
                  return;
                }
                if (editable && bulkMode && bulkSelection.size > 0) {
                  // Toggle single day in existing selection
                  const s = new Set(bulkSelection);
                  s.has(dateStr) ? s.delete(dateStr) : s.add(dateStr);
                  setBulkSelection(s);
                  setLastPicked(dateStr);
                  return;
                }
                if (editable && onEdit) {
                  setLastPicked(dateStr);
                  return onEdit(dateStr, { isBlocked, isPremium, premium: premium[dateStr] });
                }
                if (!disabled && onPick) onPick(dateStr);
              }}
              onDoubleClick={() => {
                if (editable && bulkMode) {
                  setBulkSelection(new Set([dateStr]));
                  setLastPicked(dateStr);
                }
              }}
              onTouchStart={() => startLongPress(dateStr)}
              onTouchEnd={cancelLongPress}
              onTouchMove={cancelLongPress}
              onContextMenu={(e) => e.preventDefault()}
              data-testid={`cal-day-${dateStr}`}
              title={editable ? (bulkSelection.size > 0 ? "Click to toggle · Shift+click to extend range" : "Click to edit · Double-click to start bulk selection") : title}
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
      {bulkMode && bulkSelection.size > 0 && (
        <div className="bulk-action-bar" data-testid="bulk-action-bar">
          <div className="bulk-count"><strong>{bulkSelection.size}</strong> dates selected</div>
          <div className="bulk-actions">
            <button className="btn btn-gold btn-xs" onClick={() => { onBulkEdit(Array.from(bulkSelection), "premium"); setBulkSelection(new Set()); }} data-testid="bulk-premium">💎 Mark all Premium</button>
            <button className="btn btn-red btn-xs" onClick={() => { onBulkEdit(Array.from(bulkSelection), "blocked"); setBulkSelection(new Set()); }} data-testid="bulk-block">🔴 Block all</button>
            <button className="btn btn-green btn-xs" onClick={() => { onBulkEdit(Array.from(bulkSelection), "available"); setBulkSelection(new Set()); }} data-testid="bulk-free">🟢 Clear all</button>
            <button className="btn btn-ghost btn-xs" onClick={() => setBulkSelection(new Set())} data-testid="bulk-cancel">✕</button>
          </div>
        </div>
      )}
      {bulkMode && bulkSelection.size === 0 && (
        <div className="bulk-hint" data-testid="bulk-hint">💡 Long-press (mobile) or double-click (desktop) any date to start bulk selection · Shift+click to extend range</div>
      )}
    </div>
  );
}
