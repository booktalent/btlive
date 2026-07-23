/**
 * useBookingCart — Global persistent multi-artist cart (Iter 52).
 *
 * Contract:
 * - Cart lives server-side in `carts` collection, keyed by user_id (logged in)
 *   or anon cookie (guests). Anon cart auto-merges into user cart on login.
 * - Exposes `items`, `count`, `add(item)`, `remove(id)`, `patch(id, patch)`,
 *   `clear()`, `refresh()`.
 * - Also mirrors to localStorage for optimistic UI (renders instantly on
 *   page load while the network round-trip resolves in the background).
 * - `savePendingBookNow(item)` — stashes an item + redirect intent so that
 *   after login we can auto-add + jump to /cart (the "Amazon flow").
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import api from "./api";
import { useAuth } from "./auth";

const LOCAL_KEY = "bt_cart_v1";
const PENDING_KEY = "bt_pending_booknow";

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeLocal(items) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(items || [])); } catch { /* storage disabled */ }
}

export function useBookingCart() {
  const { user } = useAuth();
  const [items, setItems] = useState(readLocal);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/cart");
      const next = r.data.items || [];
      setItems(next);
      writeLocal(next);
    } catch (e) {
      // Server unreachable — keep optimistic local copy.
      if (typeof console !== "undefined") console.warn("cart refresh failed", e?.message || e);
    }
  }, []);

  // Refresh on mount + whenever auth state flips (anon→user merges server-side).
  useEffect(() => { refresh(); }, [refresh, user?.id]);

  const add = useCallback(async (item) => {
    setLoading(true);
    try {
      const r = await api.post("/cart/items", item);
      await refresh();
      return r.data;
    } finally { setLoading(false); }
  }, [refresh]);

  const remove = useCallback(async (id) => {
    setItems((prev) => prev.filter((x) => x.id !== id));  // optimistic
    try { await api.delete(`/cart/items/${id}`); } finally { refresh(); }
  }, [refresh]);

  const patch = useCallback(async (id, changes) => {
    try { await api.patch(`/cart/items/${id}`, changes); } finally { refresh(); }
  }, [refresh]);

  const clear = useCallback(async () => {
    setItems([]); writeLocal([]);
    try { await api.post("/cart/clear"); } finally { refresh(); }
  }, [refresh]);

  const count = useMemo(() => items.length, [items]);

  return { items, count, loading, add, remove, patch, clear, refresh };
}

// ── Pending "Book Now" intent (survives login redirect) ────────────────────
export function savePendingBookNow(intent) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(intent)); } catch { /* ignore */ }
}
export function readPendingBookNow() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function clearPendingBookNow() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}
