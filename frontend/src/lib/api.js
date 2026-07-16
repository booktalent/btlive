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

const client = axios.create({ baseURL: API });

client.interceptors.request.use((cfg) => {
  const tok = localStorage.getItem("bt_token");
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

export default client;

export const formatApiError = (e) => {
  const d = e?.response?.data?.detail;
  if (!d) return e?.message || "Something went wrong";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" ");
  return JSON.stringify(d);
};

export const mediaUrl = (id) => (id ? `${API}/media/${id}` : null);
export const thumbUrl = (id) => (id ? `${API}/media/${id}/thumb` : null);

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
