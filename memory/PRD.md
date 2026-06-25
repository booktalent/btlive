# BookTalent — Product Requirements Document

## Original Problem Statement
Transform the static UI mock into a fully functional, production-ready full-stack marketplace
(React + FastAPI + MongoDB) for booking artists across India. Every placeholder feature,
dummy button, and static page must be wired to real database operations and business logic.
Treat as a premium enterprise SaaS, not a demo.

## User Personas
- **Customer** — books artists for events (weddings, corporate, private parties)
- **Artist** — creates a profile, takes bookings, gets paid, can buy promotion packages
- **Agency** — manages a roster of artists
- **Corporate** — books at scale
- **Admin** — operates the full marketplace ERP

## Architecture
- **Backend**: FastAPI + Motor (MongoDB) + JWT, in-process WebSocket manager for chat
- **Frontend**: React 18 + React Router + custom dark-luxury theme (PRESERVED, no redesign)
- **File storage**: MongoDB binary with Pillow compression + 400×400 thumbnails
- **PDF**: ReportLab (contracts + invoices)
- **Email**: Resend (mock fallback)
- **Payments**: Razorpay + Stripe + PayPal (mock fallback for boost; Razorpay for bookings)
- **Routers**: `iter7_routes.py` (Enterprise ERP), `chat_routes.py` (Live chat WS + REST)

## Modules — Status

### Done (Iter 1-6, Feb 2026 earlier)
- Auth with email OTP + JWT
- 5-step Onboarding Wizard, Artist Profile + packages + media manager
- Booking flow + auto-block dates + counter-offers + alternative artists
- Contract PDF + signed upload
- Razorpay (mock) + Wallet + Reviews
- Customer / Artist / Admin dashboards
- Pillow compression, replace/reorder/set-featured, dynamic gallery thumbs on cards

### Iteration 7 — Enterprise (Feb 2026)
- Master Data CRUD (Categories / Cities / Event Types / Languages) — admin editable, public catalogs
- FAQs, CMS pages, System Settings (key-value)
- Notification Templates (email/sms/whatsapp/push/in_app) with `{token}` interpolation
- Smart Notification Engine (`notification_service.py`) — multi-channel + mock fallback + `db.notifications_log`
- Booking auto-notify: customer + artist + admins on confirmation
- Broadcast — admin blast to any audience
- Audit Logs — every admin write
- Boost / Promotion System — 9 types × 5 durations, 11 seeded packages, auto-expiry, admin manual-assign + cancel
- Advanced Search — 13 filters, sort, pagination, type-ahead suggestions, popular, saved, history
- Reports — revenue (GMV/platform/boost), top artists by revenue

### Iteration 8 — Rotation + KYC + Coupon + Chat (Feb 2026)
- **Dynamic Artist Thumbnail Rotation** — `<ArtistCardThumb>` component used by Landing + Search:
  - Featured image first, then rotates remaining gallery images every 3.5s with crossfade
  - Single image → static; no images → emoji fallback
  - Pauses on hover, preloads next, IntersectionObserver scoped (100s of cards OK)
  - Progress dots at bottom of card; deduped URL list
- **KYC Polish**
  - Strict field validation: Aadhaar (12 digits regex), PAN (`[A-Z]{5}[0-9]{4}[A-Z]`), file-type whitelist, 5 MB cap
  - Decisions: approve / reject / **request_resubmission** (new)
  - Smart-notification + audit-log on every decision
  - Aadhaar masked in admin queue (`XXXX-XXXX-9012`)
  - Frontend: full form (name/DOB/Aadhaar+number/PAN+number/Bank/Selfie), status pill, reason banner, locked when pending/approved
- **Coupon Redemption Ledger + Analytics**
  - `_validate_coupon()` checks expiry, max_uses, per_user_limit, min_order, applies_to
  - Booking creation writes `db.coupon_redemptions` row, increments `usage_count` + `total_discount`
  - `GET /api/admin/coupons/analytics` — per-coupon uses / discount given / GMV / net revenue (sorted by uses desc)
  - `GET /api/admin/coupons/{id}/redemptions` — full ledger with user + booking
  - Admin UI: 4 KPI cards + table + drill-down ledger modal
- **Live Chat (WebSocket)**
  - `WS /api/ws/chat/{booking_id}?token=<jwt>` — JWT-authenticated, booking-participant-only
  - Events: `message`, `typing`, `read`, `presence`
  - REST fallback: `GET/POST /api/chat/{bid}/messages`, `POST /api/chat/{bid}/read`
  - Off-line notification: in-app row when recipient not in room
  - Frontend `<ChatBox>` — bubbles (gold for self), typing indicator, ✓/✓✓ read receipts, autoscroll, live status pill
  - Embedded in `BookingsTable` row (💬 Chat button → modal)
  - Verified end-to-end via `wss://` through ingress

### Backlog (P2)
- Real provider keys: Twilio SMS, Gupshup/Meta WhatsApp, FCM Push (channels scaffolded)
- Photo/video reviews + moderation
- S3/Cloudinary media migration
- Agency dashboard + roster management
- Corporate dashboard + bulk booking
- AI semantic search via Emergent LLM key
- ChatBox: file/image upload, voice notes, video call escalation
- Move WebSocket ConnectionManager to Redis pubsub (multi-replica scaling)

### Tech Debt
- `server.py` is ~2.6k lines → split into `routes/{auth,booking,media,kyc,coupons,...}.py`
- React admin components could move into per-feature folders
- Add CI pytest sweep to GitHub Actions

## Key Endpoints (Iter8 additions)
| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/kyc/submit`, `/api/kyc/mine` | artist | strict validation, multi-field |
| `/api/admin/kyc?status=...` | GET admin | filtered queue |
| `/api/admin/kyc/decide` | POST admin | approve / reject / request_resubmission + notify + audit |
| `/api/coupons/validate?code=&base_amount=&event_type=` | GET auth | strict validation |
| `/api/admin/coupons/analytics` | GET admin | per-coupon analytics |
| `/api/admin/coupons/{id}/redemptions` | GET admin | ledger drilldown |
| `/api/chat/{bid}/messages` | GET/POST auth | REST history + post |
| `/api/chat/{bid}/read` | POST auth | mark all read |
| `/api/ws/chat/{bid}?token=` | WS | live messaging + typing + read receipts |

## Test Results
- **iter8**: 100% backend (22/22 new + 62/63 full sweep — 1 skip = known iter7 calendar collision)
- **iter8**: 100% frontend (all 17 admin tabs render, search rotation visible, chat modal works, coupon KPIs render)
- Reports: `/app/test_reports/iteration_5.json` (audit), `iteration_6.json` (iter7), `iteration_7.json` (iter8)
- Test files: `/app/backend/tests/test_iter6.py`, `test_iter7.py`, `test_iter8.py`

## Test Credentials
- Admin: `admin@booktalent.com` / `Admin@123`
- Customer: `customer@booktalent.com` / `Customer@123`
- Artist: `priya@booktalent.com` / `Artist@123` (verified)
- Alt artist: `vortex@booktalent.com` / `Artist@123`
- Mock email + payment OTP: `123456`
