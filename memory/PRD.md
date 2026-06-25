# BookTalent — Product Requirements Document

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

## Iter 12 — Payment-Gated Chat (this round)
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
