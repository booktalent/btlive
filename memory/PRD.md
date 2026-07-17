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
