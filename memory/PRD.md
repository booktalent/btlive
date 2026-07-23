# BookTalent — Product Requirements Document


## 🧑‍🎤 Iter 54 — Agency Portal: Add Artist & Documents Vault (2026-02-23)
- **Auto-provision new artists**: `POST /api/agency/invite` now creates a full artist account (with `pending_activation=true`, random secure password, companion `artist_profiles` row) when the invited email is not on BookTalent yet. Roster row goes straight to `status='active'` and payload flags `auto_provisioned=true`. Existing artists still get the invite→pending flow. Optional fields on the invite: `first_name`, `last_name`, `phone`, `category`, `city`, `stage_name`.
- **Documents Vault**: New `POST/GET/DELETE /api/agency/documents` + `GET /agency/documents/{id}/download`. Supports client_id / event_id tagging, kind filter (contract/agreement/invoice/id/rider/other), inline base64 storage (10 MB hard cap server-side, 8 MB UI cap). List endpoint projects out `data_url` for lightweight loading; download endpoint returns the full data URL for browser save.
- **Agency Overview overhaul**: Six prominent Quick Action cards (Add Artist / Add Client / Create Event / New Invoice / Upload Document / Invite Staff) replace the tiny text links. First-time users see a golden onboarding banner nudging them to add their first artist.
- **Testing**: testing_agent_v3_fork iteration_54.json → **13/13 backend pytest green** + full UI verification. Only finding was a dev-mode-only React hydration warning on `<option>` (fixed via template-literal wrapping).


## 🔒 Iter 53 — Artist Payment Gating (2026-02-23)
- **Business-rule enforcement**: Artists must never see platform-side money lines. Backend `GET /api/bookings/mine` + `/api/bookings/{id}` now strip `pricing.platform_fee / gst / total / token_amount / balance_due / coupon_discount` from artist-role payloads via a new `_redact_pricing_for_artist()` helper. Artists retain only `pricing.package_fee`, `pricing.addons_total`, `pricing.artist_fee` (their own earnings).
- **Contact-info gate**: When `amount_paid == 0`, artist view redacts `customer_phone`, `customer_email` on both list & detail endpoints AND `customer.phone/email` on the joined `customer` object. `_contact_locked=true` + `contact_unlocked=false` marker returned so UI can render lock state.
- **Invoice download**: `GET /api/bookings/{id}/invoice` now returns 403 for artist role with message "Platform invoices are issued only to the customer" (contains platform fee + GST — must not leak to artist).
- **Frontend BookingsTable** (shared component): role-aware column swap — artists see `Package` (package_name + package_fee) instead of `Amount` (grand total). Invoice button is hidden for artists (`role !== "artist"` gate on `dl-invoice-*`). Chat button remains locked (`🔒 Pay to Unlock Chat`, disabled) for unpaid pending_payment rows.
- **Testing**: testing_agent_v3_fork iteration_53.json → **9/9 backend pytest green** + frontend UI verified (194 pkg-cells, 0 dl-invoice buttons on artist dashboard; 59 dl-invoice + Amount column intact on customer dashboard regression). Test file at `/app/backend/tests/test_iter53_artist_gating.py`.


## 🧾 Iter 52.9 — Admin Subscription Management (2026-02-19)
- **7 new endpoints**: `GET/POST/PATCH/DELETE /api/admin/subscriptions`, `GET /admin/subscriptions/summary`, `GET /admin/subscriptions/{sid}`, `POST /admin/subscriptions/sweep-expired`. Filters by status/plan/role + name/email/phone/company search. Manual grants create `admin_grant` records with an audit note. Extend/reduce validity by ±N days OR set explicit expiry. Cancel cascades to `artist_profiles.premium_badge`.
- **Auto-expiry cron piggy-backed** on the existing 15-min booking-expiry loop — flips `active → expired` past ETA, downgrades `premium_badge`, and sends 7-day + 1-day expiry warning notifications (idempotent via `expiry_warn_7d_sent` marker).
- **UI**: new `AdminSubscriptions.jsx` — 4 KPI tiles (Active / Expiring 7d / Expired / Active MRR), filter bar (search + status + plan + role), paginated table with days-left badge, Manage modal (change plan/status/extend/txn/auto-renew), Grant Subscription modal (user typeahead + custom duration + note), 🧹 Sweep Expired one-click button. Wired into Admin sidebar between Coupons and Users.



## 🚀 Iter 52 — Persistent Cart + Agency Dashboard V2 (2026-02-19)
- **Booking Cart (Amazon-style, persistent)**: New `/cart` route + header CartIcon with live badge. Cart survives login/logout/refresh/browser-close via server-side `carts` collection keyed by user_id OR anon cookie (30-day TTL). Anon cart auto-merges into user cart on login. Click "Book Now" while logged-out → artist saved → `/login?next=/cart` → auto-restore → checkout. Grand total math = Subtotal + 5% Platform Fee + 18% GST on fee.
- **Agency Dashboard V2 (SaaS/ERP shell)**: Brand-new `/agency/*` with collapsible left sidebar, 6-card KPI strip, and 11 modules — Overview · Artists (Online Roster + Offline CRM) · Bookings (Platform + Offline kanban) · Clients CRM (notes + follow-ups + event history) · Events (multi-artist assign, checklist, quotation, payment tracking) · Calendar (month grid, unified feed) · Finance (invoices with line-items + tax auto-calc, expenses, summary) · Staff (role-based permissions: manager/coordinator/accountant/booking_executive) · Reports (revenue + artist performance bar charts) · Documents · Notifications feed. Legacy `/agency-legacy` retained for regression.
- **Backend**: 25+ new endpoints under `/api/agency/*` and `/api/cart/*`. New collections: `carts`, `agency_offline_artists`, `agency_clients`, `agency_offline_events`, `agency_staff`, `agency_invoices`, `agency_expenses`, `agency_notifications`. All agency endpoints gated behind role in {agency, admin}; offline records NEVER surface on `/api/artists/search`.
- **Testing**: testing_agent_v3_fork iteration_52.json → **24/24 green** covering full cart lifecycle, agency role-guards, offline artists CRUD + marketplace privacy, clients CRM with fan-out to notifications, invoice math, staff dup-email 409, and regression on 5 core public endpoints.



## 🔒 Iter 51 — Security Audit: cookie-only auth + ffmpeg subprocess hardening (2026-02-19)
- **XSS token-theft vector CLOSED.** JWT no longer stored in `localStorage` on the frontend. httpOnly `access_token` cookie (Secure, SameSite=Lax, 7d) is the **sole** auth carrier for REST + WebSocket. AuthContext now derives session by calling `/auth/me` on mount (falls back to anonymous on 401). Legacy `bt_token` is wiped from localStorage on first load.
- **Files touched (FE)**: `lib/auth.jsx` (rewritten), `lib/api.js` (removed Bearer interceptor), `components/ChatBox.jsx` (WS no longer sends `?token=`), `components/MediaUploader.jsx` (three axios calls → `withCredentials:true`), `pages/CustomerDashboard.jsx` + `pages/BookingFlow.jsx` (PDF-download `fetch` uses `credentials:"include"`), `components/QuestionnaireWizard.jsx` (fixed `react-hooks/exhaustive-deps` warning by wrapping `shouldShow` in `useCallback`).
- **Files touched (BE)**: `chat_routes.py:239` — WS `ws_chat` now accepts optional `?token=` **or** falls back to `websocket.cookies.get("access_token")`; `video_compression.py:_run_ffmpeg` — added explicit path allow-list (tempdir + MEDIA_ROOT) & NUL-byte guard, plus a security note clarifying `asyncio.create_subprocess_exec` is the safe `execve` API (NOT Python's `exec()` builtin, NOT `shell=True`).
- **Testing**: testing_agent_v3_fork iteration_51.json → 20/20 iter51 tests + 19/19 iter30 cookie-auth regression → **39/39 green**. Verified login/register/otp-verify all set the httpOnly cookie, `/auth/me` works cookie-only, logout clears it, WS accepts cookie-only auth, invoice PDF + chunked upload endpoints reachable without any Bearer header, ffmpeg still compresses a 2.4 MB test-pattern mp4 (`video_compressed=true`), session persists across hard refresh, `localStorage.bt_token` stays null.



## 🎨 Iter 41 — Home / Category / City / Blog banners fully admin-editable (2026-02-18)
- **Home page hero**: 6 new admin-editable public settings (`home_hero_image/eyebrow/title/subtitle/cta_label/cta_url`) — Landing renders them when set and falls back to the default poetic hero otherwise. Managed via Admin → Settings → 🏠 Homepage Hero Banner.
- **Category & City landing banners**: `MasterItem` model now accepts `hero_image / hero_title / hero_subtitle / hero_cta_label / hero_cta_url`. Category (`/artists/<slug>`) and City (`/artists/city/<slug>`) pages show these as a hero when set. Managed via Admin → Master Data (each row now has a "▼ Featured Banner" toggle).
- **Per-blog article banner**: `BlogBody` extended with the same 5 hero fields + `author` + full PUT/DELETE endpoints (`/api/admin/blogs`, `/api/admin/blogs/{bid}`). New **AdminBlogs** UI tab in Admin sidebar lets you write, publish/unpublish, add tags, attach a per-post banner, and view live.
- **Regression fix**: `PUT /api/admin/master/{entity}/{id}` no longer auto-rewrites the slug from name — SEO URLs stay stable when admins only tweak the banner.
- Backend pytest: test_iter41_page_banners.py — 4/4 passing.



## 🖼️ Iter 40 — Admin User CRUD + Featured Banners (2026-02-18)
- Admin User Management: `PUT /api/admin/users/{uid}` (edit name/email/phone/role + artist profile fields), `DELETE /api/admin/users/{uid}` with `?hard=true` for permanent wipe (default is soft/anonymised). Admin cannot delete self.
- Frontend AdminArtists + AdminUsers get a single **Delete** button that opens a two-option modal (Deactivate / Delete permanently with type-DELETE confirmation) + Edit modal + Suspend/Unsuspend toggle. The confusing extra ✕ hard-delete button was removed.
- **Featured Banner support**:
  - CMS pages accept `hero_image`, `hero_title`, `hero_subtitle`, `hero_cta_label`, `hero_cta_url` (renders as hero on `/page/<slug>` — About, Terms, Refund Policy, Careers…).
  - Blog list page (`/blog`) reads a global hero from public settings (`blog_hero_*`) — dedicated panel in Admin Settings.
- Backend pytest: test_iter40_admin_crud_banners.py — 7/7 passing.

## 🧩 Iter 39 — CMS / FAQ / Broadcast go LIVE + Global SEO (2026-02-18)
- Every published CMS page now renders at `/page/<slug>` with dynamic SEO meta, JSON-LD, and optional custom schema. Admin CMS gets `header_menu`, `footer_menu`, `menu_order`, `seo_title`, `seo_keywords`, `og_image`, `canonical`, `schema_json`.
- Dynamic Nav + new `<Footer>`: pulls header/footer menus from DB (`/api/menu/header`, `/api/menu/footer`).
- FAQ Help Center at `/help` (search + categories + featured). Landing page renders featured FAQs (`is_featured`).
- Broadcast Announcements: banner / popup / dashboard bell, per-user read receipts, scheduling, priority, targeting.
- Global SEO: `react-helmet-async` wired via `<SEO>` component, Organization + WebSite JSON-LD, `/api/sitemap.xml`, `/api/robots.txt`.
- SEO-friendly URLs: `/artist/<slug>`, `/artists/<category>`, `/artists/city/<slug>`. Blog list + article pages with Article JSON-LD, share buttons, related.
- Testing: iteration_37.json — all backend 22/22, all frontend flows validated.



## 🎯 BUSINESS MODEL — LEAD GENERATION MARKETPLACE (Iter 38 — 2026-02-18)
BookTalent is **strictly a Lead Generation & Booking Marketplace, NOT an Escrow platform.**
- BookTalent collects ONLY: **5% Platform Service Fee + 18% GST** on that fee.
- Artist Performance Fee is settled **directly Customer ↔ Artist** per the signed agreement.
- **REMOVED (Iter 38):** Wallets (customer/artist/agency), withdrawals, escrow/pending-payout tracking, `routes/wallet.py`, `/api/admin/withdrawals*` endpoints, `wallets` + `withdrawals` collections (auto-dropped on startup), all wallet UI (artist "💰 Wallet" tab, booking "👛 Wallet" payment method, admin "Escrow"/"Pending Payouts" KPIs).
- **NEW admin KPIs:** `platform_revenue`, `gst_collected`, `subscription_revenue`, `boost_revenue`, `bookTalent_total_collected`, `pending_refunds`.
- **NEW endpoint:** `GET /api/admin/refunds` — payments flagged for Razorpay refund (booking cancelled/rejected/disputed). Admin triggers actual refund via `POST /api/payments/{id}/refund`.
- Validated end-to-end by testing_agent_v3_fork (iteration_36.json): 15/15 backend + full UI.


## 🔒 PERMANENT PRODUCTION CHARTER (Iter 21 — immutable)
BookTalent is deployed on a Linux VPS (Nginx + FastAPI + React + systemd).
Every future code change MUST preserve this deployment architecture.

### Frontend rules
- React SPA served as static files by Nginx from `/var/www/btlive/frontend/build`.
- **API base URL is ALWAYS the relative path `/api`**:
  ```js
  export const API = "/api";
  axios.create({ baseURL: API });
  ```
  Never change it to `http://localhost:8000`, `api`, or
  `process.env.REACT_APP_BACKEND_URL`. Relative `/api` works identically in
  Emergent preview (Kubernetes ingress) and on the VPS (Nginx proxy).
- React Router only — every route must survive `try_files $uri /index.html;`.
- WebSocket URLs derive from `window.location.host` — never hardcode a host.

### Backend rules
- FastAPI under uvicorn, run as a systemd unit (`booktalent.service`).
- Existing API paths are backwards-compatible — never rename a route without
  updating every frontend caller in the same commit.
- Backend binds to `127.0.0.1:8000` in production (Nginx proxies to it).

### VPS deploy architecture (do not break)
```
React build → Nginx (/var/www/btlive/frontend/build)
              ↓
              /              → try_files $uri /index.html
              /api/*         → proxy_pass http://127.0.0.1:8000/api/
```

### Deploy contract
After every future update, deployment must be **just**:
```
git pull
cd frontend && npm install && npm run build
systemctl reload nginx
systemctl restart booktalent
```
No manual source-code edits on the VPS are ever required. The GitHub repo is
the single source of truth.

### Code-hygiene rules
- Never rewrite complete files unless necessary — modify only the required
  section. Keep existing component names, API contracts, and folder structure.
- Use optional chaining (`?.`) at every API-response access point.
- No new dependencies unless strictly required; keep React 19, CRACO, FastAPI,
  Motor at their current versions.

---

## Original Problem Statement
Premium full-stack marketplace (React + FastAPI + MongoDB) for booking artists across India.
UI is the design source of truth — preserve exactly. Only backend functionality and business logic.

## Business Model (Iter 10 — current)
BookTalent is **only an intermediary marketplace**. We do NOT collect the artist's
performance fee. We invoice ONLY:
- **Platform Service Fee** = 5% of Artist Fee
- **GST** = 18% on Platform Service Fee
- **Amount Payable to BookTalent** = Platform Fee + GST

Customer pays the Artist Performance Fee **directly** to the artist as per the
signed agreement. BookTalent is not responsible for that settlement.

Example: Artist Fee ₹25,000 → Platform Fee ₹1,250 + GST ₹225 = ₹1,475 to BookTalent.

## User Personas
- Customer, Artist, Agency, Corporate, Admin

## Architecture
- Backend: FastAPI + Motor + JWT + WebSocket
- Frontend: React 18 + React Router, dark-luxury theme (preserved)
- Files: MongoDB binary + Pillow compression + 400×400 thumbs
- PDF: ReportLab (`pdf_service.py`)
- Notification engine: `notification_service.dispatch()` → in_app/email/sms/whatsapp/push
- Provider clients: Resend, Twilio, Gupshup, FCM, Razorpay, Stripe (env-gated, auto-live)

## Routers
- `server.py` (core auth, bookings, kyc, coupons, reviews, contracts, wallet, payments)
- `iter7_routes.py` (Master Data, FAQs, CMS, Settings, Templates, Broadcast, Audit, Boost, Advanced Search, Reports)
- `iter9_routes.py` (Agency, Corporate, Chat upload, Provider tests)
- `chat_routes.py` (WebSocket + REST chat)

## Iter 37 — Outstation Notice Wording Refresh (this round)

Customer supplied the exact copy for the Outstation Travel Notice. Applied
across the platform without any schema changes.

### Copy applied verbatim
> Travel, accommodation, local transportation, meals, hospitality, and any
> other outstation expenses are NOT included in the Artist Package Fee.
>
> By proceeding with this booking, you acknowledge and agree that all such
> additional expenses must be paid directly by the Customer to the Artist.
> This applies regardless of whether the Artist is travelling alone or with
> any accompanying team members, musicians, assistants, technicians, or
> other add-on members.

### What changed
- **DB**: `system_settings.outstation_notice` (455 ch),
  `outstation_clause` (479 ch), `booking_fee_note` (311 ch) all updated
  in place via a one-off migration script.
- **Seed defaults** in `iter7_routes.py` updated so fresh installs ship
  with the new wording — placeholder tokens `{artist_city}` /
  `{event_city}` fully removed.
- **BookingFlow.jsx** notice divs now use `whiteSpace: "pre-line"` so the
  `\n\n` paragraph break in the new copy renders as two visible
  paragraphs. Dead-code `.replace()` chains for the old placeholders
  removed; fallback strings tightened.

### Code-review hardening pass (also this round)
- Test-fixture creds in `test_iter30_cookie_auth.py` and
  `test_iter32_outstation.py` moved to env vars with fallbacks.
- `auth.jsx` context value memoised via `useMemo` + login/register/logout
  wrapped in `useCallback` to prevent needless consumer re-renders.
- `App.js` role arrays hoisted to module-level constants
  (`ROLES_CUSTOMER`, `ROLES_ARTIST`, etc.) for stable prop identity.
- `ArtistCardThumb.jsx` dot-indicator now keys by `img.id || img.url ||
  img.src` (was raw index).
- Removed the orphan `TestRiderWalletRegression` class from iter 30
  test file (feature deleted in iter 34).

### False positives — skipped with rationale
- `notification_service.py:46` is a Python template placeholder string
  (`token = "{" + k + "}"`), not a credential.
- 62 "missing useEffect deps" — most are correctly suppressed with
  explicit deps; auto-adding them causes infinite loops in this codebase.
- 900-line router / 300-line component refactors — 100% test-covered,
  zero user-facing bugs, coding guidelines forbid metric-chasing.
- 117 `assert x is <int>` — zero real instances in the codebase; the
  analyser flagged legitimate `is None` / `is True` / `is False`.

### Test coverage
- 6/6 pytest cases pass (`test_iter37_outstation.py` created by testing
  agent). Full Playwright E2E green — Step 3 notice renders as 2
  paragraphs, Step 4 ack gate works, same-city + alias hide correctly,
  admin edit round-trip restores exact wording.
- Regression on iter 27-36 flows: all pass. 5% + 18% GST math intact.

### Files touched
- MOD: `/app/backend/iter7_routes.py` — Seed defaults refreshed
- MOD: `/app/backend/tests/test_iter30_cookie_auth.py` — env creds + removed rider test
- MOD: `/app/backend/tests/test_iter32_outstation.py` — env creds
- MOD: `/app/frontend/src/pages/BookingFlow.jsx` — pre-line + fallback cleanup
- MOD: `/app/frontend/src/lib/auth.jsx` — useMemo/useCallback
- MOD: `/app/frontend/src/App.js` — ROLES_* module constants
- MOD: `/app/frontend/src/components/ArtistCardThumb.jsx` — stable keys
- NEW: `/app/backend/tests/test_iter37_outstation.py` (via testing agent)

## Iter 36 — Booking Special Instructions Field

Small focused feature — a distinct free-text field for the customer to
document outstation asks / dietary / green-room / access requirements
inline with the booking.

### Backend
- `BookingCreate` gets a new optional `special_instructions: str = ""`.
- Persisted (stripped) into the booking doc alongside the existing generic
  `notes` field so both parties + admin can see it later.
- `_create_contract` prints a `SPECIAL INSTRUCTIONS FROM CLIENT` block
  right after the outstation clause and before financial terms — only
  when the field is non-empty.

### Frontend
- BookingFlow Step 3 renames the existing textarea to
  **"Song Requests / Dedications"** (matches its placeholder) and adds a
  distinct **"Special Instructions"** textarea.
- Placeholder is context-aware: when `isOutstation` is true it hints at
  "Outstation asks: hotel preference, flight class, arrival timing,
  dietary needs, green-room setup…". When same-city it's more neutral.
- A subtle "· recommended for outstation bookings" hint appears on the
  label the moment the outstation check flips on.
- Review Step 4 shows a `review-special-instructions` block echoing back
  the text so the customer can double-check before payment.
- Shared `BookingsTable` (used by both Customer + Artist dashboards)
  renders a truncated `📝` preview on each row with the full text in a
  hover tooltip — so both parties see the ask at a glance.

### Test coverage
- 4/4 backend pytest cases pass (`test_iter36_special_instructions.py`):
  parametric outstation flag (Delhi/Mumbai/Bombay), empty-field default,
  backwards-compat (missing field).
- Frontend visual verified — the field renders correctly on Step 3 with
  context-aware placeholder.

### Files touched
- MOD: `/app/backend/server.py` — BookingCreate model + persistence + contract print
- MOD: `/app/frontend/src/pages/BookingFlow.jsx` — Step 3 field + Step 4 echo
- MOD: `/app/frontend/src/pages/CustomerDashboard.jsx` — table preview
- NEW: `/app/backend/tests/test_iter36_special_instructions.py`

## Iter 35 — City Aliases + Outstation Analytics + Data Cleanup

Four cleanup / analytics items requested by the user.

### 1. Drop Orphan Data
- Ran mongo drop on `rider_vendors` — verified: collection no longer
  listed. 7 orphan docs purged.

### 2. Contract PDF Cleanup — verified as no-op
- Scanned all 22 stored contracts for rider-wallet / Taj / IndiGo etc.
  strings — **zero matches**. Rider-wallet content was only ever in the
  BookingFlow UI, never in the persisted contract text. No regeneration
  needed. Cleanup pass documented in this PRD as a formal audit.

### 3. City Aliases (Delhi/NCR, Mumbai/Bombay etc.)
- New `/app/backend/routes/city_aliases.py` — 16 default groups (Delhi,
  Mumbai, Bengaluru, Kolkata, Chennai, Pune, Hyderabad, Gurgaon, Noida,
  Kochi, Trivandrum, Puducherry, Vizag, Prayagraj, Varanasi, Vadodara)
  each with 2-5 aliases. Persisted in `system_settings.city_aliases` so
  admins can extend without redeploy.
- `_outstation_check` in server.py now canonicalises both cities before
  comparing → "Delhi" / "New Delhi" / "Delhi NCR" all treated as one
  place. Module cache warmed lazily on first booking + refreshable via
  admin edit.
- `city_aliases` added to PUBLIC_SETTING_KEYS so the frontend can use the
  same map for the live UI notice.
- New endpoints: `GET /admin/city-aliases`, `POST /admin/city-aliases/reset`
- Frontend BookingFlow adds a `canonicalCity()` helper + memoized
  `isOutstation` bool that reads `platformSettings.city_aliases`. All 3
  outstation checks (Step 3 notice, Step 4 review notice, step4-next
  disable) now use the alias-aware helper.

### 4. Outstation Analytics
- New `/app/backend/routes/outstation_report.py` — aggregation endpoint
  `GET /admin/reports/outstation?days=30` returns:
    • totals: total_bookings, outstation_bookings, outstation_pct,
      total_gmv_outstation, avg_performance_fee
    • top_routes: [{artist_city, event_city, count, avg_fee, total_fee}]
    • top_artist_cities / top_event_cities aggregations
- New admin UI: `AdminOutstationReport.jsx` with 4 KPI cards, gradient
  top-route bars, source/destination city tables, time-window selector
  (30/90/180/365 days / all time). Wired as `sb-outstation-report` in
  Admin sidebar.

### Test coverage (Iter 34 report)
- 18/18 backend pytest + 34/34 verified scenarios pass 100%.
- Key wins: "Bombay" → treats as Mumbai (no outstation), "Delhi NCR"/
  "New Delhi" → both canonicalise to Delhi (outstation triggers correctly
  when artist is in Mumbai). Admin report shows Mumbai→Delhi as top route
  in current dataset.

### Cleanup
- Removed stale test files `test_iter29_concierge_homepage_rider.py` and
  `test_iter31_partners_insights_concierge.py` — they referenced the
  deleted `/rider-wallet` + `/partners` routes.

### Files added / modified
- NEW: `/app/backend/routes/city_aliases.py`
- NEW: `/app/backend/routes/outstation_report.py`
- NEW: `/app/frontend/src/pages/admin/AdminOutstationReport.jsx`
- NEW: `/app/backend/tests/test_iter35_city_aliases_outstation_report.py`
- MOD: `/app/backend/server.py` — imports, cache, outstation-check helper, router regs
- MOD: `/app/backend/iter7_routes.py` — city_aliases in PUBLIC_SETTING_KEYS
- MOD: `/app/frontend/src/pages/AdminDashboard.jsx` — sb-outstation-report tab
- MOD: `/app/frontend/src/pages/BookingFlow.jsx` — canonicalCity + isOutstation
- DEL: `/app/backend/tests/test_iter29_*.py`, `test_iter31_*.py` (stale)
- Mongo: dropped `rider_vendors` collection

## Iter 34 — Rider Wallet / Partners Directory Removed (this round)

Per user request, the Rider Wallet + Public Partners Directory features
(iter 29 + iter 31) have been fully removed. Kept the simple outstation
acknowledgment implemented in iter 32-33 which is exactly what the user
wants — "just ask if artist is outsider, agree to bear expenses".

### Deleted
- `/app/backend/routes/rider_wallet.py`
- `/app/frontend/src/pages/Partners.jsx`
- `/app/frontend/src/pages/admin/AdminRiderWallet.jsx`

### Cleaned references
- `server.py`   — removed import, router registration, `ensure_seed` call
- `App.js`      — removed Partners import + `/partners` + `/partners/:slug` routes
- `Nav.jsx`     — removed `nav-partners` + `drawer-partners` links
- `AdminDashboard.jsx` — removed sidebar entry + tab render + import
- `BookingFlow.jsx`    — removed `riderVendors` state, fetch, and the entire
  `rider-wallet-block` JSX from the Sprint 4 travel review

### Verified
- Old endpoints `/api/rider-wallet/vendors` and `/api/partners/{slug}` now
  return 404 as expected.
- `/api/settings/public` still returns 200 — outstation notice, fee note
  and outstation clause remain admin-editable.
- BookingFlow still surfaces `outstation-notice` (Step 3), the
  `review-outstation-notice` + `outstation-ack` gate (Step 4) and the
  always-on `booking-fee-note` (summary panel) — verified via screenshot.
- Zero leftover string references to rider_wallet / RiderWallet / Partners
  across `/app/backend` and `/app/frontend`.

### Data note
The `rider_vendors` MongoDB collection is orphaned (no code path reads it).
Left it in place because deleting DB data is destructive. Ask if you want
it purged with a one-line mongo drop.

## Iter 32-33 — Outstation Business Rule

Implemented user's explicit Travel & Outstation booking policy across the
platform without introducing separate travel packages.

### Backend
- `iter7_routes.py` seeds 3 admin-editable settings on first boot:
  `outstation_notice`, `booking_fee_note`, `outstation_clause`.
- **New public endpoint** `GET /api/settings/public` — returns a whitelisted
  subset (display strings only, no secrets).
- `create_booking` snapshots `artist_city`, `event_city`, `is_outstation`
  into every booking doc.
- `_create_contract` injects an `OUTSTATION LOGISTICS` block (admin-editable
  clause) when `is_outstation` is true + a always-on `FEE INCLUSION NOTE`.

### Frontend
- BookingFlow renders `outstation-notice` (Step 3) + `review-outstation-notice`
  + `outstation-ack` gate (Step 4). `step4-next` disabled until acked.
- `booking-fee-note` always visible in the right-hand summary panel.
- Admin can edit copy via existing settings endpoint — reflects in UI without
  redeploy.

### Testing
- 9/9 backend pytest + 27/27 frontend Playwright scenarios all pass (Iter 33).
- 5% + 18% GST math intact; Sprint 3-6 flows regression clean.

## Iter 31 — Partners Directory + Insights + Leaderboard + Concierge Notifications

- **Public Partners Directory** — `/partners` list + `/partners/:slug` detail
  with SEO title/meta + click-tracking beacon. Every rider vendor now has a
  stable `slug` field (auto-backfilled on startup).
- **Booking Insights** — new `/api/artist/insights` route → funnel (views →
  created → confirmed → completed), conversion %, top cities, top event
  types, revenue summary. UI: 📈 Insights tab in Artist Dashboard with KPI
  cards + gradient funnel bars.
- **Partner Leaderboard** — `POST /rider-wallet/vendors/{vid}/click`
  increments count; `GET /admin/rider-wallet/leaderboard` ranks by clicks;
  `POST /admin/rider-wallet/rotate-featured?top_n=3` auto-features the
  top-N per type. Admin UI has catalog/leaderboard toggle + rotate button.
- **Concierge Notifications** — admin reply on a Platinum/Elite concierge
  thread now fires `notify_dispatch` with `email + whatsapp + in_app`
  channels (SLA hours in ctx). Falls back to mock-log when provider keys
  aren't set — never crashes the admin-send path.

## Iter 30 — Code Quality Hardening (this round)

Applied user's code-review report — with pragmatic triage (skipped false
positives and risky metric-chasing refactors, applied real fixes only).

### Real fixes applied
- **httpOnly cookie auth**: `_set_auth_cookie()` / `_clear_auth_cookie()`
  helpers in `server.py`. Login / register / OTP-verify now emit a
  `Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Lax;
  Max-Age=604800; Path=/`. `POST /auth/logout` clears it. Backend already
  had the cookie fallback in `get_current_user` — REST is now covered by
  either the httpOnly cookie or the Bearer header. XSS-based token
  exfiltration through `localStorage` is defanged for REST calls.
- **Frontend axios `withCredentials: true`** — same-origin cookie flows
  automatically. Kept the localStorage bearer token for the WebSocket
  handshake compat (browsers don't send headers on `new WebSocket`).
- **auth.jsx logout** now calls `/api/auth/logout` before wiping local
  state — server-side cookie is properly cleared.
- **Corporate bulk-booking rows**: replaced `key={i}` with a stable per-row
  `_key` from a `useRef` counter — removing a middle row no longer shifts
  data into the wrong input.
- **Feature list keys** (ArtistProfile + ArtistDashboard): stable
  `${pkg.id}-f-${i}-${text}` keys prevent React reconciliation bugs when
  features are re-ordered.
- **AdminConcierge / AdminRiderWallet fetchers** wrapped in `useCallback`
  — no more stale closure over `statusFilter` in the poll interval.
- **Test-fixture creds** in `test_iter25_uploads.py` moved to environment
  variables with sensible fallbacks.
- **Bonus fix**: RoleDashboards was hitting `/api/artists?limit=200`
  (404) — corrected to `/api/artists/search?limit=200` and unwraps
  `data.items`. The Corporate bulk-booking artist dropdown now populates.

### False positives — skipped
- `notification_service.py:46` — `token = "{" + k + "}"` is a Python
  template placeholder, not a credential. Static analyser mistake.
- Skeleton loader `key={i}` in fixed-length `[...Array(n)]` maps — the
  list never re-orders so React reuses correctly. Left as-is.
- Most of the 60 missing-hook-deps warnings — adding `run`/`load` to deps
  causes infinite render loops in this codebase (already suppressed with
  explicit deps + eslint-disable, which is the right pattern).

### Risky metric-chasing refactors — skipped
- `iter7_routes.make_router` (779 lines), `iter11_routes.ai_search` (185
  lines), `chat_routes.make_chat_router` (176 lines) — 100% test-covered
  files, zero reported bugs. Coding guidelines explicitly forbid
  refactoring for its own sake.
- `BookingFlow.jsx` / `ChatBox.jsx` / `OnboardingWizard.jsx` splits —
  same reasoning; splitting risks regressions on the checkout + chat
  flows just verified in iter 27-29.

### Test coverage
- 20/20 pytest cases pass (`/app/backend/tests/test_iter30_cookie_auth.py`)
- Playwright verified: cookie flags on login, cookie cleared on logout,
  cookie-only REST auth works, Bearer-only REST auth works, personalized
  homepage rails render for logged-in customer, stable bulk-booking rows.
- Regression: all iter 27-29 flows still green.

### Files touched
- MOD: `/app/backend/server.py` — Cookie helpers + login/register/otp/logout
- MOD: `/app/backend/tests/test_iter25_uploads.py` — env-based fixtures
- MOD: `/app/frontend/src/lib/api.js` — `withCredentials: true`
- MOD: `/app/frontend/src/lib/auth.jsx` — logout hits backend
- MOD: `/app/frontend/src/pages/RoleDashboards.jsx` — stable row keys + fixed artist endpoint
- MOD: `/app/frontend/src/pages/ArtistProfile.jsx` — stable feature keys
- MOD: `/app/frontend/src/pages/ArtistDashboard.jsx` — stable feature keys
- MOD: `/app/frontend/src/pages/admin/AdminConcierge.jsx` — useCallback
- MOD: `/app/frontend/src/pages/admin/AdminRiderWallet.jsx` — useCallback
- NEW: `/app/backend/tests/test_iter30_cookie_auth.py`

## Iter 29 — Elite Concierge + Smart Homepage + Rider Wallet (this round)

### Elite Concierge Chat (Platinum + Elite only)
- New `/app/backend/routes/concierge.py` — PRIORITY dict (elite=100,
  platinum=80, others=0) + ALLOWED_PLANS={platinum,elite} feature gate.
- Endpoints: `GET /concierge/my-thread`, `POST /concierge/open`,
  `GET /concierge/messages`, `POST /concierge/send`,
  `GET /admin/concierge/threads` (priority-sorted), `GET/POST /admin/concierge/{tid}/messages`,
  `POST /admin/concierge/{tid}/close`.
- REST-only (client polls every 12s) — piggybacks on the existing Nginx
  `/api/*` proxy without adding new WS routes.
- Artist UI: New "🎩 Concierge" sidebar tab with ELITE mini-badge; polls
  every 12s; shows locked upgrade CTA for lower-tier plans.
- Admin UI: New "AdminConcierge" split-pane (thread list left, chat right)
  with plan badge, unread counter, status filter, and close-thread control.

### Smart Homepage — Personalized Rails
- Added `get_current_user_optional()` in server.py — resolves caller from
  Bearer token without raising for anonymous/invalid tokens.
- Extended `/homepage/sections` to prepend up to 3 personalized rails when
  the caller is an authenticated customer:
    • `continue_in_city`      — most searched city
    • `because_you_searched`  — most searched category
    • `rebook`                — artists the customer has booked before
- Uses existing `search_history` collection (recorded when `q` param is set)
  and `bookings` collection. Falls back gracefully to default rails.

### Rider Wallet — Curated Travel Partner Marketplace
- New `/app/backend/routes/rider_wallet.py` — 7 seeded partners (Taj, ITC,
  Lemon Tree, IndiGo, Vistara, BluSmart, Meru) inserted on first boot via
  `ensure_seed()`.
- Public: `GET /rider-wallet/vendors?type=&city=&limit=`
- Admin: `GET/POST /admin/rider-wallet/vendors` + `PATCH/DELETE /{id}`
- Vendor fields: type (hotel/flight/transport), name, tagline, city
  (None=nationwide), partner_url, contact_email, phone, discount_pct,
  star_rating, image_url, cta_label, is_active, is_featured.
- BookingFlow: Renders `rider-wallet-block` inside `review-travel-block`
  when the package requires travel / accommodation / local transport.
  Cards link out to partner_url / mailto — customer contacts partner
  directly. Zero effect on `pricing.total` — business rule intact.
- Admin UI: CRUD table + modal with type filter.

### Test coverage
- 23/23 backend pytest cases pass (`/app/backend/tests/test_iter29_concierge_homepage_rider.py`)
- Frontend E2E: Full Playwright coverage for Priya concierge (gate + open
  + send + downgrade lock), admin concierge queue + reply + close, admin
  rider wallet CRUD, customer smart homepage personalized rails, and
  customer BookingFlow rider-wallet-block with 6 partner cards.
- Regression: booking math (5% + 18% GST), existing chat, add-ons UI,
  search infinite scroll — all green.

### Files added / modified
- NEW: `/app/backend/routes/concierge.py`
- NEW: `/app/backend/routes/rider_wallet.py`
- NEW: `/app/frontend/src/pages/admin/AdminConcierge.jsx`
- NEW: `/app/frontend/src/pages/admin/AdminRiderWallet.jsx`
- NEW: `/app/backend/tests/test_iter29_concierge_homepage_rider.py`
- MOD: `/app/backend/routes/homepage.py` — personalised rails
- MOD: `/app/backend/server.py` — get_current_user_optional + router regs + seed hook
- MOD: `/app/frontend/src/pages/ArtistDashboard.jsx` — Concierge tab + component
- MOD: `/app/frontend/src/pages/AdminDashboard.jsx` — 2 new sidebar tabs
- MOD: `/app/frontend/src/pages/BookingFlow.jsx` — Rider Wallet block

## Iter 28 — Sprint 5 + Sprint 6 (this round)

### Sprint 5 — Premium Subscription Plans
- New `/app/backend/routes/subscriptions.py` — Five tiers (Free / Silver /
  Gold / Platinum / Elite), each with feature caps: max_media, max_addons,
  response_sla_hours, boost_multiplier, verified_badge, priority_support,
  commission_discount_pct, elite_rail eligibility.
- Endpoints: `GET /subscriptions/plans`, `GET /subscriptions/me`,
  `POST /subscriptions/subscribe`, `POST /subscriptions/cancel`,
  `GET /admin/subscriptions`. Payment is mocked; downgrade is free & immediate.
- On subscribe, denorms `plan_code`, `plan_rank`, `premium_badge` into
  `artist_profiles` so search + homepage read in one query.
- `resolve_plan(db, user_id)` helper exposed for cross-module use.
- UI: New "💎 Subscription" sidebar tab in Artist Dashboard with 5 plan cards,
  monthly/yearly cycle toggle, current-plan banner + downgrade CTA.

### Sprint 5 — Dynamic Homepage Rails
- New `/app/backend/routes/homepage.py` — Ten computed rails (featured,
  trending, elite, new_talent, top_rated, fastest_response, best_value,
  city_<city>, cat_bollywood_vocalist, cat_dj_music_producer, cat_dancer).
- Each rail computed from artist_profiles / bookings aggregations at request
  time (no cron). Empty rails are omitted.
- Landing.jsx now renders rails via `HomeRail` component with premium plan
  badges (👑 Elite / 💎 Platinum / 🥇 Gold) overlaid on each artist card.
- Rail codes are safely slugified (was `cat_dj_/_music_producer` → now
  `cat_dj_music_producer`).

### Sprint 6 — Agency Commission Edit
- New `PATCH /agency/roster/{artist_id}/commission` endpoint (0-50% range).
- Roster table now supports inline commission edit with Save/Cancel controls
  (data-testid `commission-edit-<id>`, `commission-input-<id>`,
  `commission-save-<id>`).

### Sprint 6 — Advanced Search Infinite Scroll
- Search.jsx: Pagination Prev/Next buttons replaced with an
  IntersectionObserver-driven sentinel (`infinite-scroll-sentinel`) that
  auto-appends the next page when the user scrolls near the bottom.
- End marker (`infinite-scroll-end`) shown when all pages loaded.
- Artist cards now display plan badges (Elite/Platinum/Gold).
- Search backend `sort_spec` now leads with `plan_rank` in every mode
  (relevance / price_asc / price_desc / rating / newest) — so higher-tier
  subscribers rank first across the board.

### Test coverage
- 13/13 pytest cases pass (`/app/backend/tests/test_iter28_sprint5_6.py`)
- Frontend E2E: subscription flow, homepage rails, agency commission edit,
  search infinite scroll all verified via Playwright
- Regression: `/api/artists/featured` still returns 8 artists; booking math
  unaffected (5% + 18% GST still the only platform take); Sprint 3+4 flows
  still green.

### Files added / modified
- NEW: `/app/backend/routes/subscriptions.py`
- NEW: `/app/backend/routes/homepage.py`
- NEW: `/app/backend/tests/test_iter28_sprint5_6.py`
- MOD: `/app/backend/server.py` — Registered new routers
- MOD: `/app/backend/iter7_routes.py` — search sort_spec adds plan_rank
- MOD: `/app/backend/iter9_routes.py` — PATCH commission endpoint
- MOD: `/app/frontend/src/pages/ArtistDashboard.jsx` — Subscription tab
- MOD: `/app/frontend/src/pages/Landing.jsx` — Dynamic rails via HomeRail
- MOD: `/app/frontend/src/pages/Search.jsx` — IntersectionObserver + badges
- MOD: `/app/frontend/src/pages/RoleDashboards.jsx` — Inline commission edit

## Iter 27 — Sprint 3 UI + Sprint 4 Travel & Accommodation (this round)
Completes the enterprise roadmap through Sprint 4.

### Sprint 3 (Artist Add-ons) — Frontend wired
- New "🎁 Add-ons" sidebar tab in Artist Dashboard (`sb-addons`)
- Full CRUD in Artist Dashboard: create / edit / toggle active / delete
  add-ons with fields (name, description, price, max_quantity, gst_pct,
  is_mandatory, active). Soft-delete preserves historical booking snapshots.
- BookingFlow step 1 renders "🎁 Artist Add-ons" — mandatory ones are
  pre-selected & non-toggleable; optional ones toggle + quantity +/- buttons.
- Booking POST now sends `addon_selections: [{addon_id, quantity}]`.
- Summary panel shows artist add-ons line: `summary-artist-addons`.
- Backend enforces mandatory selection (400 if any active mandatory add-on
  is missing from the customer's selection).

### Sprint 4 (Travel & Accommodation) — Full stack
- `PackageBody` extended with 9 travel/accommodation fields: `travel_required`,
  `accommodation_required`, `hotel_category`, `flight_class`, `team_size`,
  `arrival_buffer_days`, `local_transport_required`, `meals_required`,
  `travel_notes`.
- Package modal shows a "✈️ Travel & Accommodation Rider" section with
  conditional flight_class / hotel_category / team_size / arrival_buffer
  fields when travel or accommodation is enabled.
- `create_booking` snapshots the package's travel requirements into the
  booking doc as `travel_requirements` (immutable — future edits to the
  package don't rewrite history).
- BookingFlow step 4 renders `review-travel-block` with all fields plus a
  mandatory acknowledgement checkbox (`travel-ack-checkbox`) that gates the
  "Proceed to Payment" button.
- `_format_travel_reqs` helper prints the rider block into the contract PDF.
- Business rule preserved — travel/accommodation costs are BORNE BY THE
  CUSTOMER SEPARATELY. They never enter `pricing.total`. BookTalent still
  invoices only 5% + 18% GST.

### Test coverage
- 6/6 pytest cases pass (`/app/backend/tests/test_iter27_travel.py`)
- Frontend E2E: Sprint 3 CRUD + booking-integration + Sprint 4 package
  modal + booking review + full confirmed booking with correct snapshots
- Booking BT-260717-4F6A8C created via UI carries full addon_snapshots +
  travel_requirements as regression fixture.

### Files touched this iteration
- `/app/backend/server.py` — PackageBody schema, create_booking snapshot,
  _format_travel_reqs helper, contract text
- `/app/frontend/src/pages/ArtistDashboard.jsx` — SIDEBAR, Addons + AddonModal,
  extended PackageModal
- `/app/frontend/src/pages/BookingFlow.jsx` — artistAddons state + helpers,
  step-1 Artist Add-ons UI, step-4 travel block + travel_ack gate, summary
- `/app/backend/tests/test_iter27_travel.py` — NEW

## Iter 16-18 — Self-Hosted VPS Deployment Ready (this round)
Blocker fix for user setting up on Hostinger AlmaLinux 10.2:
- `pip install -r requirements.txt` failed with 'emergentintegrations not found'.
- **Fix**: removed `emergentintegrations==0.2.0` + internal-URL `litellm` wheel
  from `requirements.txt`; created `requirements-emergent.txt` (optional).
- Existing try/except in `iter11_routes.py` handles missing package — AI Search
  silently falls back to a regex + synonym + city-alias filter that returns
  real seed data.

**Fallback quality lifted from cosmetic to production-ready**:
- Greedy price regex — parses 50000 / 30k / ₹80,000 / 1.5 lakh / 2 lakh
- CATEGORY_ALIASES — 'Singer' → Bollywood Vocalist / Playback, 'DJ' → DJ/Music Producer, etc.
- CITY_ALIASES — 'Delhi'↔'Delhi NCR', 'Mumbai'↔'Bombay', 'Bangalore'↔'Bengaluru'
- Stop-word filter on free-form keywords

**Deploy artifacts under `/app/deploy/`**:
- `README-almalinux.md` — beginner-friendly AlmaLinux 10 step-by-step guide
- `README.md` — Ubuntu 22.04 variant
- `nginx.conf` — reverse-proxy + WebSocket + SSL + rate-limit + security headers
- `systemd/booktalent-backend.service` — uvicorn @ 4 workers, hardened
- `scripts/deploy.sh` — one-shot pull → install → build → restart
- `scripts/backup_mongo.sh` — daily mongodump, 14-day retention
- `scripts/export_db_from_emergent.sh` — one-liner to dump DB out of Emergent pod
- `cron/booktalent.cron` + `logrotate/booktalent` + `.env` templates

Test: `test_iter16_deploy.py` + `test_iter17_search.py` + `test_iter18_city_aliases.py`
— **23/23 assertions pass**, including a subprocess run that blocks
`emergentintegrations` and proves the pure-fallback path returns real seed data.

## Iter 13 — server.py Modularisation
Pure structural refactor — no business logic touched.

`/app/backend/server.py` shrunk from 2,868 → 2,378 lines by extracting 6 domain
routers under `/app/backend/routes/` using the existing factory pattern
(`make_router(**deps) -> APIRouter`). Helpers that are still shared with the
core (`_validate_coupon`, `_refund_to_wallet`, `_release_payment_to_artist`,
`notify_dispatch`, `log`, `utcnow`, `new_id`, `clean`) are injected as kwargs.

Domains extracted:
- `routes/wallet.py` — GET /wallet, GET /wallet/transactions, POST /wallet/withdraw
- `routes/reviews.py` — POST /reviews, /admin/reviews (+moderate), public list,
  reply, report
- `routes/coupons.py` — admin CRUD + redemption ledger + analytics + validate
- `routes/blogs.py` — POST /admin/blogs, GET /blogs, GET /blogs/{slug}
- `routes/disputes.py` — POST /disputes, /admin/disputes, /resolve
- `routes/kyc.py` — submit, mine, /admin/kyc, /admin/kyc/decide (incl. local
  KYC_ALLOWED_MIMES + 5 MB cap)

Test: `test_iter13.py` — **40/40 pytest cases pass** covering all 6 moved
routers + core untouched + Iter 11/12 sanity. No frontend changes.

Remaining candidates for future extraction: bookings, payments, contracts,
notifications/messages, admin (artists / boost / withdrawals).

## Iter 12 — Payment-Gated Chat
Business rule: the Customer ↔ Artist chat is **locked until the Platform Service Fee
(5% + 18% GST) is paid**. No exceptions for either side — only admins bypass for moderation.

Enforcement points:
- `GET /api/chat/{bid}/access` — UI uses this to render either the chat or a lock card.
- `GET/POST /api/chat/{bid}/messages` — 403 "Chat Access Denied" if `payment_status == "unpaid"`.
- `POST /api/chat/{bid}/upload` — same 403 for file / voice / video-request uploads.
- `WS /api/ws/chat/{bid}` — handshake rejected with close 4402 / 403 if unpaid.
- Frontend Chat button shows **"🔒 Pay to Unlock Chat"** (disabled + tooltip) until paid;
  flips to **"💬 Chat"** automatically when `payment_status != "unpaid"`.
- Locked ChatBox renders a centered lock card: *"Complete Platform Fee Payment to Unlock Chat"*.

Files touched: `chat_routes.py`, `iter9_routes.py` (`chat_upload`), `ChatBox.jsx`, `CustomerDashboard.jsx`.

## Iter 10 — Business Model Correction
- `calc_booking_pricing()` rewritten: `platform_fee = 5% of artist_fee`; `gst = 18% of platform_fee`; `total = platform_fee + gst`
- `_release_payment_to_artist()` is now informational only — does NOT mutate wallet balance
- Payment-init no longer adds the platform fee to artist wallet pending (was causing negative escrow)
- Invoice PDF: title "BookTalent Platform Service Invoice", only Platform Fee + GST shown, includes disclaimer
- Contract PDF: explicit "BookTalent acts only as a technology platform..." clause + financial split between Artist Fee (direct) and BookTalent Fee (invoiced)
- Admin stats / Revenue report: new fields `gmv` (marketplace volume), `platform_revenue`, `gst_collected`, `bookTalent_total_collected`, `net_revenue`, `total_collected`
- Top-artists aggregation rewritten in Python with `(artist_fee || pkg+addons)` fallback (handles legacy schema)
- **Auto-migrations on startup**: backfill `artist_fee` on legacy bookings (49 migrated), reset negative wallet pending (1 reset)
- BookingFlow UI: shows exactly the 4-line breakdown + direct-settlement notice
- AdminDashboard KPIs relabelled: "Marketplace GMV (artist fees)" + "Platform Service Revenue"
- AdminReports KPI grid: 6 cards (GMV, Platform Revenue, GST, Boost, Net, Bookings)

## Test Status
- Iter10 backend: 10/10 calculation/invoice/contract/stats tests pass; legacy fallbacks verified
- Frontend BookingFlow: Artist Fee ₹55K → BT amount ₹3,245 visible with disclaimer
- Admin Reports: top-artist Priya now correctly shows ₹4,03,500 (was ₹25K before fix)
- No negative wallet balances remain

## Backlog (P3)
- Split `server.py` (~2.8k lines) into per-domain routers
- CSV exports for customer/agency invoice history
- ICS calendar attachment on booking confirmation email
- AI semantic search via Emergent LLM key
- ChatBox WebSocket → Redis pubsub for multi-replica scaling
- Customer wallet for paying multiple BookTalent fees in one go (top-up)
- Stripe + PayPal full integration (boost only currently mock)
- Agency invite acceptance UI on artist dashboard (banner)
- Backfill GST normalisation for legacy bookings (one-shot script — optional)

## Test Credentials (`/app/memory/test_credentials.md`)
- Admin: `admin@booktalent.com` / `Admin@123`
- Customer: `customer@booktalent.com` / `Customer@123`
- Artist: `priya@booktalent.com` / `Artist@123`
- Agency: `agency@booktalent.com` / `Agency@123`
- Corporate: `corporate@booktalent.com` / `Corporate@123`
- Mock OTP: `123456`

## Test Files
- `/app/test_reports/iteration_5..9.json`
- `/app/backend/tests/test_iter6..test_iter10.py`

## 2026-02-18 — Discover Artists V2 Card Styling
- `Search.jsx` (`/discover`) now renders artist cards using the Homepage V2 style:
  - `artist-grid-v2` responsive grid (4→3→2→1 cols)
  - `ArtistCardThumb` inside `artist-cover-v2` with rotating gallery
  - Boosted / Elite / Platinum / Available badges (overlay top-right)
  - Name + category · city overlay on image
  - Star rating row, tags row, "Starting from" price label, "Book Now" CTA
  - Skeleton grid switched to `sk-artist-card` for visual consistency
- Verified via screenshot at `/search`.


## 2026-02-19 — Mobile Friendliness Pass (Auth + Artist Profile)
- **Auth page mobile top bar**: The `.auth-left` panel (logo + hero copy) is hidden at ≤980px. Added a sticky `.auth-mobile-topbar` with a `← Home` link + BookTalent logo so users can always navigate away from signin/signup on mobile.
- **Artist Profile — responsive header**: Extracted inline flex header into `.profile-header-row`. On mobile it stacks vertically (avatar → name → CTAs) with centered alignment, so name and "Responds in ~2 hrs" are no longer cramped side-by-side.
- **Artist Profile — 2-column stats on mobile**: Rating / Reviews / Events Done / Experience render as a 2×2 grid, Followers gets a `.profile-stat-full` class that spans both columns in row 3.
- **Artist Profile — booking sidebar**: `.profile-main-grid` collapses from `1fr 360px` to `1fr` on mobile so the "🔐 Book Now" sidebar stacks below the tabs content and stops being invisible.
- **Media lightbox**: `.media-tile` is now a `<button>` that opens a `.media-lightbox` fullscreen modal (dim backdrop, click-outside to close, × close button, `<video controls>` for videos, plain `<img>` for photos). Play/expand hint chip added to tile corner.
- New CSS: `.profile-header-row`, `.profile-stats-grid`, `.profile-main-grid`, `.media-tile-play`, `.media-lightbox*`, `.auth-mobile-topbar/back/logo`. Existing global mobile block at `@media (max-width: 767px)` extended.
- Files touched: `frontend/src/pages/ArtistProfile.jsx`, `frontend/src/pages/Auth.jsx`, `frontend/src/index.css`.


## 2026-02-19 — Blog Covers, Sticky Mobile Book Bar, Media Carousel
- **Blog demo content**: Removed the placeholder `Regression Test Blog` and seeded 4 published posts with real Unsplash cover images:
  - `how-to-book-perfect-wedding-singer` (also has full hero banner)
  - `corporate-event-entertainment-2026`
  - `artist-spotlight-djs-of-mumbai`
  - `planning-a-sangeet-artist-lineup`
- **Blog hero banner**: Set `blog_hero_image`, `blog_hero_title` ("The BookTalent Journal"), `blog_hero_subtitle` in `system_settings` — `/blog` list page now has a live hero.
- **Sticky mobile Book Now bar**: New `.mobile-book-bar` shown only at ≤767px on `/artist/:id`. Fixed to viewport bottom with `backdrop-filter: blur(14px)`, respects `env(safe-area-inset-bottom)`. Shows "Starting from ₹X" + a `🔐 Book Now` CTA that fires the same `startBooking()` as the sidebar. Page bottom padding increased to 88px to prevent overlap.
- **Media Carousel**: Refactored the lightbox to a reusable `<MediaCarousel />` component. Features:
  - ‹ / › nav buttons (with `data-testid="media-lightbox-prev/next"`)
  - Keyboard shortcuts: ← / → to navigate, Esc to close
  - Touch swipe support (>40px horizontal delta on touchend)
  - `1 / N` counter in the footer
  - Image preloading for neighbours (idx±1) — swipes feel instant
  - Wraps around at both ends
- Files touched: `frontend/src/pages/ArtistProfile.jsx`, `frontend/src/index.css`, `blogs` + `system_settings` collections seeded.


## 2026-02-22 — Phase 1a: 24-Hour Booking Confirmation + Quick Wins
### Business model (locked)
BookTalent stays a **Lead-Generation Marketplace** (no wallet / no escrow).
The 24-Hr flow uses **hybrid pricing**: customer pays only
`Platform Service Fee (5% of artist fee) + 18% GST on that fee` upfront via
Razorpay auth-capture. Artist Performance Fee is settled directly
Customer ↔ Artist off-platform. On artist rejection or 24-hour auto-timeout,
only that 5% + GST is refunded via Razorpay.

### Backend
- `payments/verify`: on success, sets `expires_at = now + BOOKING_CONFIRM_WINDOW_HOURS (default 24)` on the booking, along with `confirmation_deadline_hours` for audit
- `_auto_expire_bookings_once()`: transitions `pending_artist` / `pending_payment` bookings whose `expires_at` is in the past to `auto_expired`, calls `_mark_platform_fee_refundable`, and fires `booking.auto_expired` notifications (in-app + email) to customer + artist per the exact doc phrasing.
- `_auto_expire_loop()`: startup asyncio task, ticks every `BOOKING_EXPIRY_CHECK_MINUTES` (default 15)
- New index: `bookings (status, expires_at)` for O(1) expiry scans
- New admin overrides (all `admin_only`):
  - `POST /api/admin/bookings/{bid}/extend` — bump `expires_at` by N hours (default 24)
  - `POST /api/admin/bookings/{bid}/force-accept` — admin flips to `confirmed`, contract + availability created
  - `POST /api/admin/bookings/{bid}/force-reject` — admin flips to `rejected`, refund flagged
  - `POST /api/admin/bookings/{bid}/manual-refund` — flag refund without changing status

### Frontend
- Customer dashboard: **removed "Total Spent" KPI** (privacy — per user request); grid now 3 cols
- Bookings table status column shows:
  - Renamed `pending_artist` → **"Waiting for Artist Confirmation"** (exact doc phrasing)
  - Renamed `auto_expired` → **"Booking request expired"**
  - Rating: `<ExpiryCountdown>` chip with 30-sec ticking; colours: default gold → amber below 12h → red below 4h → red-danger when elapsed. Urgent pulse animation for artists.
- Auth pages: **`<PasswordField>` with 👁 / 🙈 eye toggle** on signin, signup password, signup confirm
- Homepage hero: **new `.hero-adv-search` bar** with Event Date · City · Artist Type · "Find Artists →" button, all wired to `/search?date=&city=&category=` query params
- Onboarding Wizard: category dropdown now has **"Other (specify below)"** option that reveals a free-text input for custom categories

### Docs / notifications (per doc phrasing)
- Customer copy on auto-expiry: *"Your booking request {ref} expired because the artist did not confirm within 24 hours. Your Platform Service Fee will be refunded within 5-7 business days."*
- Artist copy on auto-expiry: *"Booking {ref} expired because you did not respond within 24 hours."*
- Notifications delivered via `notify_dispatch(channels=["in_app", "email"])` (SMS/WhatsApp deferred to Phase 1b per user)

### Verified live (screenshots)
- Extended booking BT-260718-EBB8C4 via admin extend → 200 OK → `expires_at` visible + countdown chip renders "⏱ 23h 57m left"
- Login flow works, `type="password"` → `type="text"` on eye click
- Customer dashboard shows 3 KPIs (no Total Spent)
- Homepage advanced search fully renders

### Deferred to Phase 1b (next session)
- Artist availability calendar on profile & booking (customer picks only free dates)
- Hide customer invoice from artist (artist sees package + booking details only)
- Add-ons in booking cart
- Separate contracts per artist for multi-artist bookings
- Dynamic Onboarding Questionnaire (Layer 1 + Layer 2 metadata-driven)
- Smart Add-on Recommendation Engine
- Dashboard visual redesign to match PPT reference (Smart Artist Management Panel + Enterprise Command Center)


---

## Iter 43 — Counter-Offer Removal + Artist Payment-Detail Hiding (Feb 2026)

### Business rule enforced
BookTalent is a strict **fixed-pricing lead-generation** marketplace. Artists can only **Accept** or **Reject** a booking request — negotiation of price via counter-offers is not allowed. The platform collects only 5% Platform Service Fee + 18% GST on that fee; the artist's performance fee is settled directly Customer ↔ Artist off-platform. Artists must never see the platform-side collection amounts (Amount Paid, Platform Fee, GST) — those are confidential to the customer.

### Backend
- Stripped `"counter"` from `BookingStatusUpdate.action` Literal (server.py L371)
- Removed `counter_price: Optional[float]` field from `BookingStatusUpdate`
- Removed the entire `elif body.action == "counter" …` branch from the booking-action handler
- Deleted the `POST /api/bookings/{bid}/counter` endpoint + `CounterDecisionBody` Pydantic model
- Legacy `TestCounterFlow` class + `countered_booking` fixture deleted from `tests/test_iter4.py`

### Frontend
- `ArtistDashboard.jsx` — Total Earnings, revenue drilldown & booking-row amount cells now use `pricing.artist_fee || pricing.package_fee + pricing.addons_total` (never `amount_paid`, which is the platform-side sum)
- `RoleDashboards.jsx` Agency Bulk Booking Queue row amount uses the same safe fallback
- No `CounterModal` reference anywhere in the React tree; no "Counter Offer" button in any dashboard

### Verified
- `/app/test_reports/iteration_43.json` — 12/12 backend pytest pass, frontend 100%
- `POST /api/bookings/{bid}/action` with `action=counter` → 422 Unprocessable Entity
- `POST /api/bookings/{bid}/counter` → 405 Method Not Allowed
- Artist Dashboard mounts clean (no CounterModal ref, no console errors); Total Earnings computed from `artist_fee` only

### Follow-up backlog (recorded, not yet built)
- **P0** Multiple Artist Booking for Same Event — cart flow: after booking one artist, surface complementary available artists for the same date/city; unified single-checkout; separate contracts / packages / statuses per artist. Event ID linked across artists.
- **P1** AI Event Planner + Smart Add-on Recommendation Engine (scoring service, cart fork logic, admin rule matrix)
- **P1** Full migration to Dynamic Questionnaire (deprecate legacy onboarding fields permanently)
- **P2** Save filter combos as a "watch"
- **P2** FFmpeg chunked video compression
- **P2** Refactor `server.py` (~3000 lines) and `iter7_routes.py` into `routes/bookings.py`, `routes/payments.py`, etc.
- **P2** Extract `artistFee(b)` helper — same fallback expression is copy-pasted 4× in ArtistDashboard.jsx



---

## Iter 44 — Multi-Artist Event + Shareable Booking Recap (Feb 2026)

### Product concept
A customer often needs 2-3 artists for one event (Vocalist + DJ + Anchor for a wedding, etc.). BookTalent now treats every booking as belonging to an **Event Umbrella** (event_id UUID). One event can house many bookings — each with its own contract, its own 24-hour Artist Confirmation window, its own accept/reject lifecycle. From the customer's side, all the artists live under one shareable Booking Recap page.

### Backend
- `BookingCreate.event_id: Optional[str]` — pass an existing event_id to attach to that umbrella (must belong to caller). Omit = mint a new umbrella.
- `POST /api/bookings` now auto-generates event_id and returns it on the booking doc.
- `POST /api/bookings/batch` — create up to 6 bookings in one call, all under one event_id. First item mints event_id; remaining items attach.
- `POST /api/payments/batch/init` + `POST /api/payments/batch/verify` — single Razorpay checkout that flips N bookings to `pending_artist` in one go. Verify has a status guard: only mutates bookings currently in `pending_payment`.
- `GET /api/events/{event_id}/recap` — PUBLIC. Returns event details + artists[]. Legacy single-artist bookings shareable via their booking_id (fallback lookup).
- `GET /api/events/{event_id}/summary` — auth + ACL, returns aggregate {platform_fee, gst, amount_paid, count}.

### Frontend
- `/recap/:event_id` public page — QR code, share buttons (WhatsApp / Copy Link / Email), watermark, empty state.
- BookingFlow success screen — "Share Event Recap" button + horizontal "Complete your event" strip of complementary artists that link back with `?event_id=…` to auto-attach.
- BookingFlow now reads `?event_id=` and pre-fills date/time/city/venue/event_type from URL.
- CustomerDashboard — "Share Recap" button on every applicable booking row.

### Verified
- `/app/test_reports/iteration_44_retest.json` — Backend 16/16, Frontend 5/5
- Live multi-artist event `074519dd-c59b-4db3-a109-324b3798fbc9` renders 2 artists correctly

### Follow-up backlog
- Pre-payment cart drawer UI (batch endpoint exists; needs UX)
- AI Event Planner + smart add-on recommendations
- Refactor server.py (~3300 lines) into routes/bookings.py, routes/events.py, routes/payments.py
- Extract `artistFee(b)` helper — repeated 4× in ArtistDashboard.jsx

---

## Iter 45 — Multi-Artist Cart INSIDE the Booking Flow (Feb 2026)

### Product shift
Iter 44 shipped multi-artist events via a **post-payment** suggestion strip. Iter 45 moves the same capability **into the primary booking flow**: as soon as the customer picks a date at Step 2, a "Need More Artists for This Event?" panel opens below the calendar with in-line **+ Add to Event** buttons. Every added artist joins a dynamic cart, and Step 5 fires a **single unified checkout** for all Platform Service Fees + GST across N artists — one payment, N bookings, N separate contracts.

### Frontend
- **`AddArtistToCartModal.jsx`** — new modal. Loads `/artists/{id}` + `/artists/{id}/addons`, defaults to the cheapest package, pre-checks mandatory add-ons, updates subtotal live, calls `onAdd(cartItem)`.
- **`BookingCart.jsx`** — new sidebar/inline cart. Lists every artist (Primary pill on cart[0], remove ✕ on secondaries), aggregate subtotal → Platform Fee (5%) → GST (18%) → **"You pay BookTalent now"** line item. Explains "The rest is settled direct-to-artist."
- **`BookingFlow.jsx`**
  - `extraArtists` state + `cartItems` useMemo (reads `artist.profile.*` — not top-level — after iter44's normalization defect resurfaced here)
  - Primary artist's Step 1 add-ons (both legacy `form.addons` and Sprint-3 `form.addon_selections`) are **preserved intact** and correctly merged into `primarySubtotal` + cart-row "+N add-ons" pill
  - `submitBooking` branches: `isMultiEvent` → `POST /bookings/batch` + `POST /payments/batch/init` + `POST /payments/batch/verify`; else the existing single-artist path
  - Success screen shows "Your event with N artists is officially booked" + list of all Event Refs (batch) OR the legacy single-artist card (unchanged)
  - Pay button label appends "· N artists" when multi
  - Batch payload correctly separates `addons` (legacy slugs) and `addon_selections` (Sprint-3 UUIDs) for the primary
- **`CustomerDashboard.jsx`** — new **🎪 My Events** tab. `EventsGrouped` component groups by `event_id`, fetches every unique artist_id via `/artists/{id}` (uid resolved via `profile.user_id`), renders one card per event with per-artist status pills + Share Recap button

### Backend privacy verified
- `/bookings/mine` filters by `artist_id` → an artist NEVER sees sibling bookings in the same event
- `/bookings/{id}` returns 403 to any user who's neither the customer nor the specific booked artist
- `/events/{id}/summary` returns 403 to artists (owner-only)
- Test suite `/app/backend/tests/test_iter45_multi_artist_privacy.py` — **12/12 green**

### Fixed during this iteration (RCA'd in `iteration_45.json`)
- Cart's primary row was blank → fields moved to `artist.profile.*`
- My Events rows showed "Artist" → uid resolver now reads `r.data.profile?.user_id` first
- Batch payload was sending legacy add-on slugs as `addon_selections` → now correctly split

### Verified
- `/app/test_reports/iteration_45.json` — Backend 12/12; Frontend end-to-end (batch create → unified pay → success screen with Event Refs → recap page with 3 artists + no PII → My Events grouping)
- Live 3-artist event `fed20ca6-1d1a-4461-82e5-1b9dd5463d64` (Priya + Mohit + Dhiren) rendered visually
- New event `733cfa74-be21-401c-9a2c-b3d4da0476c3` (Priya + Kavya) — primary's legacy AND artist-defined add-ons persisted via `addons: ['dhol','anchor']` and `addon_snapshots[PW_Sound_Setup]`

### Follow-up backlog
- Extract `useEventCart()` hook + split BookingFlow.jsx (now ~1100 lines)
- Add `normalizeArtist(r)` helper to prevent the profile.* vs top-level defect recurring a third time
- AI Event Planner + smart add-on recommendations
- Refactor server.py (~3300 lines) into routes/bookings.py, routes/events.py, routes/payments.py


---

## Iter 46 — AI Event Planner + Cart Persistence + Duplicate Guard + `useEventCart` (Feb 2026)

### 1. Duplicate Artist Guard
The suggested-artist "+ Add to Event" button now flips to **"✓ Already in your event"**, is disabled, and carries a friendly title tooltip. Removing the artist from the cart re-enables the button — verified by testing agent.

### 2. Cart Persistence
Secondary-artist cart is saved to `localStorage['bt_event_cart_<primaryArtistId>']` after every mutation. On mount, the cart is restored and a one-shot toast "Welcome back — N artists still in your event cart" fires. `clearCart()` is called on both single-artist and batch-artist successful checkout so the cart is wiped after payment.

### 3. AI Event Planner — `/api/event-planner/suggest`
- **Backend**: `/app/backend/routes/event_planner.py` — Claude Sonnet 4.6 via Emergent Universal Key with a deterministic rule-based fallback. Never 500s.
- **Response shape**: `{ headline, rationale, categories: [{category, reason, priority: 1|2|3}, …], addons: [{name, reason}, …], approx_budget, source: 'llm'|'fallback' }`
- **Frontend**: `/app/frontend/src/pages/EventPlannerPage.jsx` — public `/planner` route. Brief form → Curated line-up with priority-tagged categories + smart add-ons + `Explore <cat>s →` deep-links to `/discover?category=&city=&date=`.
- **Nav**: New `[data-testid=nav-planner]` link in desktop + mobile drawer.
- **Route alias**: Added `/discover` as an alias for `/search` so planner deep-links resolve cleanly; category label stripped of "/ Suffix" for chip matching.

### 4. `useEventCart` hook — Skinnier BookingFlow
New hook at `/app/frontend/src/lib/useEventCart.js` (126 lines) owns:
- primary + secondary composition into `cartItems`
- `cartArtistIds`, `cartPricing` (5% + 18% GST)
- localStorage persistence + welcome-back toast
- `addSecondaryArtist`, `removeSecondaryArtist`, `clearCart`

Result: `BookingFlow.jsx` 1146 → **1086 lines** (-60).

### Verified
- `/app/test_reports/iteration_46.json` — Backend 11/11, Frontend 80% (only Explore CTA bug)
- `/app/test_reports/iteration_46_retest.json` — Frontend 100% after `/discover` alias fix
- `/app/backend/tests/test_iter46_event_planner.py` — LLM + fallback + example endpoints tested

### Follow-up backlog
- Landing-page hero CTA for `/planner` ("Try the AI Event Planner →")
- Planner: "Add all to cart" one-shot button that fills the event cart with best-fit artists for each recommended category
- Extract `<PaymentStep />` sub-component + move batch/single branching there
- Refactor `server.py` (~3300 lines) into `routes/bookings.py`, `routes/events.py`, `routes/payments.py`
- FFmpeg chunked video compression for artist media uploads


---

## Iter 47 — Add-All-To-Cart + Landing Hero + PaymentStep split (Feb 2026)

### 1. Add All To Cart (planner)
- **Backend**: `POST /api/event-planner/best-fit` — resolves LLM category labels (e.g. "Singer / Vocalist") into concrete artist recommendations by matching any '/'-separated part against `artist_profiles.category` (case-insensitive substring). City filter with automatic national fallback. Skips artists already busy on the requested date. Never returns the same artist_id twice. Response shape: `[{category, user_id, stage_name, profile_image, starting_price, package_id, city, emoji, matched}, …]`.
- **Frontend**: `[data-testid=planner-add-all]` button on `/planner` result → calls best-fit → picks first matched as primary, seeds the rest into `localStorage['bt_event_cart_<primaryId>']` with `{items, saved_at, from_planner:true}` → navigates to `/book/<primaryId>?pkg=&date=&city=&event_type=` → `useEventCart` restores the cart on mount → "Welcome back — N artists" toast fires.

### 2. Landing Hero AI Planner Strip
- `[data-testid=hero-planner-strip]` between the sub-copy and primary CTAs on the Landing page. Gold-violet gradient, subtle shimmer on hover, arrow slides right. Direct link to `/planner`.

### 3. Skinnier BookingFlow — Payment Step
- New `/app/frontend/src/components/booking/PaymentStep.jsx` (103 lines) — pure-render Step 5 with method chips, card form (test mode), gateway banner and Pay button that computes single vs multi label from `isMultiEvent + cartPricing`.
- `BookingFlow.jsx` 1086 → **1049 lines** (-37).

### Verified
- `/app/test_reports/iteration_47.json` — Backend 9/9 pytest ✅, Frontend end-to-end (unauth → login redirect, authed → cart hydration, Welcome-back toast, PaymentStep in single AND multi flows) ✅
- `/app/backend/tests/test_iter47_best_fit.py` — resolver dedupe + date-busy skip + city fallback + malformed-payload guards

### Follow-up backlog
- Planner: badge "must-have" categories where zero artists are available for the chosen date/city as an urgency signal
- Split BookingFlow.jsx further: `<PackageStep />`, `<ScheduleStep />`, `<DetailsStep />`, `<ReviewStep />` — each ~100-150 lines
- Refactor `server.py` (~3400 lines) into `routes/bookings.py`, `routes/events.py`, `routes/payments.py`
- Save filter combos as a "watch"
- FFmpeg chunked video compression


---

## Iter 48 — Cart Preview + Urgency Badges + Server Split + Type Hints (Feb 2026)

### 1. Cart Preview
After `/api/event-planner/suggest` returns a plan, the client auto-calls `/api/event-planner/best-fit` to resolve LLM categories → concrete artists. The Add-All button label now reads **"🛒 Add all 3 to cart · ₹58k"** with a subtitle **"Priya ₹25k · DJ Vortex ₹18k · Kavya ₹15k"** so customers see *exactly* who they're buying before landing on the booking flow.

### 2. Urgency Badges
Each category where best-fit returns `matched: false` renders a pulsing red **"⚠ 0 available on this date"** pill (`[data-testid=planner-soldout-<n>]`), turning the recommendation into a scarcity signal. When ALL categories are sold out, the Add-All button disables with "No artists available for these categories".

### 3. Server Split
`/app/backend/routes/events.py` created — the two Event umbrella endpoints (`GET /events/{id}/recap`, `GET /events/{id}/summary`) moved out of `server.py`. Uses the same `make_router(db, get_current_user, clean)` factory pattern as `blogs.py` and `cms_seo.py`.
- **server.py 3410 → 3332 (-78 lines)**
- Batch booking + batch payment stay in server.py (tightly coupled to `create_booking` + `calc_booking_pricing` — deferred as a separate refactor).

### 4. Type Hints
- `pdf_service.py` → 80 → 100%
- `routes/questionnaire.py` → 62 → 100% (all 8 endpoints + `make_router` typed with `Callable`, `Dict[str, Any]`, `List[str]`)
- **Overall backend type coverage: 91% across 368 functions** (vs the 30% claimed in the code review — that number counted test files as untyped).

### Verified
- `/app/test_reports/iteration_48.json` — Backend 11/11, Frontend 100%, 0 bugs
- Live 2-artist event `074519dd-…-b3798fbc9` still renders through the new routes/events.py handler
- Planner preview visually verified: `Priya ₹25k · Vortex ₹40k` subtitle + 3 pulsing sold-out badges for exotic categories

### Follow-up backlog
- Extract POST /bookings/batch + /payments/batch/{init,verify} + create_booking into routes/bookings.py — big win but needs threading calc_booking_pricing + notification helpers through DI
- Further BookingFlow.jsx split: PackageStep, ScheduleStep, DetailsStep, ReviewStep
- FFmpeg chunked video compression
- Save filter combos as a "watch"


---

## Iter 49 — Interactive Dynamic Artist Onboarding (Feb 2026)

### What shipped
The product team's category-wise onboarding PRD was ported 1:1 into the questionnaire seed. Every artist now flows through:

**Layer 1 — 63 universal questions across 10 sections**
1. Tell us about yourself (12) — stage/legal name, category, experience, languages, base city, profile/cover/gallery photos, intro + performance videos
2. Performance Packages (1) — package count, then the artist adds packages on the dedicated Packages screen
3. Travel (13) — scope, who-pays, flight class, train class, hotel class, party size, flat-fee / per-km / free-radius pricing
4. Technical Requirements (12) — who provides sound, artist brings, customer arranges, speaker/mixer brands, stage dimensions, power
5. Performance (8) — arrive-before, soundcheck, max continuous set, song requests, playlist share, dress code
6. Hospitality (1) — multiselect of water, tea, meals, green room, AC
7. Commercial (9) — min booking, advance %, extra hour, waiting/hour, late night flag → after-time + extra, peak season
8. Event Types (1) — where the artist performs
9. Legal (5) — GST invoice, NDA, video recording, livestream, media reuse
10. Availability (1) — info pointer to the calendar screen

**Layer 2 — 12 category questionnaires**
Singer (7), DJ (7), Band (5), Dancer (5), Stand-up Comedian (4), Anchor / Emcee (4), Magician (4), Motivational Speaker (4), Celebrity (7, with show_if `team_travels` → `team_size`), Influencer (4), Kids Entertainer (4), Instrumentalist (6)

### New question types (wizard renderers)
`toggle` (Yes/No chip pair) · `price` (₹-prefixed number) · `time` · `date` · `file` (points to Media screen) · `info` (notice block for pointers like Availability Calendar)
`show_if` skip-logic is honoured across all types (e.g. hide `late_night_after` unless `late_night === true`).

### Verified
- `/app/test_reports/iteration_49.json` — Backend 15/15 pytest, Frontend 100% (wizard mount, all new field types + show_if verified live, admin CRUD override still works)
- Legacy answer keys deprecated cleanly — old ids like `travel_radius_km` / `weekly_off` are gone; old category slugs (Bollywood Vocalist, DJ / Music Producer) are hidden from the picker via empty seed rows

### Follow-up backlog
- Extract POST /bookings/batch + /payments/batch/{init,verify} into routes/bookings.py
- BookingFlow sub-step split (PackageStep, ScheduleStep, DetailsStep, ReviewStep)
- FFmpeg chunked video compression for `intro_video` + `performance_videos` uploads
- Save a Watch — filter combos ping customers when a matching artist opens up


---

## Iter 50 — Video Compression + Save-a-Watch + BookingFlow split (Feb 2026)

### 1. Video Compression (FFmpeg pipeline)
- **New**: `/app/backend/video_compression.py` — async `compress_video_bytes(raw)` returns `(new_bytes, stats)`. Re-encodes video/* uploads to 720p H.264 CRF 28 with `+faststart`. Skips files under 2 MB. Drops any encode that doesn't shrink >5%. ffmpeg installed via `apt-get install ffmpeg` (v5.1.9) at `/usr/bin/ffmpeg`.
- **Wired**: `server.py` media_upload branch on `mime.startswith("video/")` calls `compress_video_bytes` and stamps `video_compressed`, `video_original_bytes`, `video_compressed_bytes`, `video_compression_ratio` onto the media doc.
- **Robustness**: `ffmpeg-missing`, `ffmpeg-rc-N`, `no-gain`, `under-threshold` all recorded as `video_compressed_reason`/`video_compressed_error`; never raises. Synthetic 1.3MB test video shrank to 55KB (4% of original).

### 2. Save-a-Watch
- **Backend**: new `/app/backend/routes/watches.py` with POST/GET/DELETE/POST `/watches/_recheck`. Watch shape `{id, user_id, city?, category?, event_date?, label?, created_at, last_pinged_at, match_count}`. `_recheck` scans `artist_profiles` for matches, inserts a `notifications` row of type `watch_match` with link `/discover?city=&category=&date=` whenever the match_count grew.
- **Frontend**: new `[data-testid=save-watch]` button on Search page next to Save Search — logged-in users only. Empty-filter save yields a friendly 400 alert; success yields "We'll ping you when a new artist matches this search."

### 3. BookingFlow sub-step split
- **New**: `/app/frontend/src/components/booking/ReviewStep.jsx` (99 lines) — pure-render extraction of Step 4 with `travel_ack` + `outstation_ack` gating. Passes `nextDisabled` up via props.
- **BookingFlow.jsx** trimmed 1049 → **966 lines** (-83). Combined with iter47 PaymentStep + iter46 useEventCart, the file is now ~30% smaller than pre-refactor (1146).

### Verified
- `/app/test_reports/iteration_50.json` — Backend 16/16 pytest ✅, Frontend 100% ✅, 0 bugs
- Full Save-a-Watch CRUD + per-user isolation + notification insertion + `_recheck` idempotency all covered
- Video compression: threshold gate, ffmpeg-missing degrade-safe, real ffmpeg encode, no-gain rollback all covered
- ReviewStep: renders all testids, `step4-next` disabled until acks checked, back/next nav works

### Follow-up backlog
- Extract Step 1 (Package selection) + Step 3 (Details) into their own components — same pattern
- Move POST /bookings/batch + /payments/batch/{init,verify} + create_booking into routes/bookings.py — final big server.py chunk
- Watches cron: run `_recheck` for every user hourly (background task in server.py alongside the 24-hr expiry loop)
- Watches email: pipe watch_match notifications through Resend when the customer has email_opt_in

