# BookTalent — Product Requirements Document

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
