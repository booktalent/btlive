import axios from "axios";

// ─────────────────────────────────────────────────────────────────────────────
// Production charter (BookTalent Permanent Project Rules):
// API base URL MUST ALWAYS be the relative path "/api". This works identically
// in every deployment target because the browser hits the same origin that
// serves the frontend:
//   - Emergent preview  → Kubernetes ingress routes /api/* → backend:8001
//   - User's VPS (prod) → Nginx routes /api/* → FastAPI 127.0.0.1:8000
// Do NOT change this to `http://localhost:8000`, to `api`, or to
// `process.env.REACT_APP_BACKEND_URL` — any of those would break the VPS build.
// ─────────────────────────────────────────────────────────────────────────────
export const API = "/api";

const client = axios.create({
  baseURL: API,
  // Send the httpOnly auth cookie on every request. Frontend & API share the
  // same origin (both served by Nginx / K8s ingress), so this Just Works.
  // The cookie is the SOLE auth carrier now — no more Bearer header injection
  // from localStorage (Iter 51 security audit closed that XSS-token-theft
  // vector). See auth.jsx for the migration rationale.
  withCredentials: true,
});

// ─── Iter 58 — 401 handler ─────────────────────────────────────────────
// When a request 401s (session expired mid-flow, cookie evicted by browser
// third-party rules, etc.), we intercept it to (1) rewrite the error detail
// into a customer-friendly line the UI can show, and (2) fire a one-off
// `bt:session-expired` event that AuthProvider listens for. This turns the
// old cryptic "Not authenticated" toast into a clear "Please sign in again"
// call to action WITHOUT tight-coupling axios to react-router.
let _sessionExpiredFired = false;
client.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || "";
    // Skip the /auth/me probe — a 401 there is the normal "you're anonymous"
    // signal, not a session-expiry.
    const isProbe = url.endsWith("/auth/me");
    if (status === 401 && !isProbe) {
      // Replace the generic FastAPI "Not authenticated" detail with a
      // friendlier message the UI can display verbatim.
      if (error.response && error.response.data && typeof error.response.data === "object") {
        const d = error.response.data.detail;
        if (!d || d === "Not authenticated" || d === "Token expired" || d === "Invalid token" || d === "User not found") {
          error.response.data.detail = "Your session has expired. Please sign in again to continue.";
        }
      }
      // Fire once per page-load so listeners can redirect the user to /login
      // with the current URL as the returnTo target.
      if (!_sessionExpiredFired && typeof window !== "undefined") {
        _sessionExpiredFired = true;
        try {
          window.dispatchEvent(new CustomEvent("bt:session-expired", {
            detail: { returnTo: window.location.pathname + window.location.search },
          }));
        } catch { /* SSR guard */ }
      }
    }
    return Promise.reject(error);
  }
);

export default client;

export const formatApiError = (e) => {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    // Pydantic v2 validation errors: [{loc:[…], msg, type, input?}, …].
    // Turn each entry into "field: msg" so the toast shows the actual field
    // instead of a JSON blob. Fallback to JSON when we can't recognise it.
    const lines = d.map((x) => {
      if (!x || typeof x !== "object") return String(x);
      const field = Array.isArray(x.loc) ? x.loc.filter((s) => s !== "body").join(".") : "";
      const msg = x.msg || x.message || x.type || "Invalid value";
      return field ? `${field}: ${msg}` : msg;
    }).filter(Boolean);
    if (lines.length) return lines.join(" • ");
  }
  if (typeof d === "object") {
    // Custom detail dicts (e.g. {message, alternatives}) — prefer `message`.
    if (d.message) return d.message;
  }
  return JSON.stringify(d);
};

export const mediaUrl = (id) => {
  if (!id) return null;
  // Allow external URLs (Unsplash, CDN, etc.) to pass through unchanged so the
  // same `profile_image` field can hold either a media ID or a full URL.
  if (typeof id === "string" && /^https?:\/\//i.test(id)) return id;
  return `${API}/media/${id}`;
};
export const thumbUrl = (id) => {
  if (!id) return null;
  if (typeof id === "string" && /^https?:\/\//i.test(id)) return id;
  return `${API}/media/${id}/thumb`;
};

/**
 * Pick a random gallery thumb for an artist card.
 * Rotates each page load — uses Math.random so different visitors see different photos.
 * Falls back gracefully to profile_image → cover_image → null.
 */
export const pickArtistThumb = (artist) => {
  const thumbs = artist?.gallery_thumbs || [];
  if (thumbs.length > 0) {
    // featured first if any, else random
    const featured = thumbs.find((t) => t.is_featured);
    if (featured) return thumbUrl(featured.id);
    const pick = thumbs[Math.floor(Math.random() * thumbs.length)];
    return thumbUrl(pick.id);
  }
  if (artist?.profile_image) return thumbUrl(artist.profile_image);
  if (artist?.cover_image) return mediaUrl(artist.cover_image);
  return null;
};

export const fmtINR = (n) => {
  if (n == null) return "—";
  const num = Number(n);
  if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (num >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
  if (num >= 1000) return `₹${(num / 1000).toFixed(1)}K`;
  return `₹${num.toLocaleString("en-IN")}`;
};

export const fmtINRFull = (n) => {
  if (n == null) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
