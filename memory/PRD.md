# BookTalent — Product Requirements Document

## Original Problem Statement
Build a production-ready BookTalent talent marketplace platform (Indian artist booking) with the premium dark luxury theme from the supplied HTML references. Must have real backend workflows — auth, artist profiles + media, packages, full booking workflow, **real Razorpay payments**, wallet & withdrawals, reviews, **PDF contracts/invoices**, KYC, admin panel — not just UI mockups.

## Architecture
- **Backend**: FastAPI + MongoDB + JWT (`bcrypt`, `pyjwt`), Razorpay SDK (`razorpay==1.4.2`), PDF generation (`reportlab==4.2.0`)
- **Frontend**: React 19 + react-router-dom v7
- **Styling**: Custom CSS dark luxury theme (gold + purple, Cormorant Garamond + Inter)
- **Media**: base64 stored in MongoDB, streamed via `/api/media/{id}`
- **Payments**: Razorpay live integration with safe mock fallback (when keys empty)
- **PDFs**: ReportLab — contract + GST invoice generators

## User Personas
1. **Customer / Event Planner** — books artists, manages bookings, downloads contracts/invoices, leaves reviews
2. **Artist** — manages profile/media/packages/availability, accepts bookings, withdraws earnings
3. **Agency / Corporate** — same as customer (multi-booking workflows)
4. **Admin** — moderates KYC, releases payouts, manages coupons, resolves disputes, views all contracts

## What's been implemented

### Iteration 1 (2026-06-24)
- All MVP modules: auth, artist discovery, profile pages, 5-step booking flow, customer/artist/admin dashboards
- Wallet engine, reviews, KYC, coupons, boost plans, disputes, notifications, messaging
- Seeded 6 demo artists + 1 customer + 2 coupons
- 28/28 backend tests passing

### Iteration 2 — Razorpay + PDF (2026-06-24)
- **Razorpay integration** via `razorpay==1.4.2`
  - `POST /api/payments/init` — creates real Razorpay order when keys present; mock when absent
  - `POST /api/payments/verify` — verifies Razorpay signature via `razorpay_client.utility.verify_payment_signature`; falls back to mock OTP `123456`
  - `POST /api/payments/webhook` — HMAC SHA256 verification using `RAZORPAY_WEBHOOK_SECRET`
  - `POST /api/payments/{id}/refund` — calls `razorpay_client.payment.refund` (admin-only); credits wallet
  - `GET /api/payments/config` — public, returns `{razorpay_enabled, razorpay_key_id, currency}`
- **PDF generation** (`pdf_service.py`)
  - `GET /api/contracts/{cid}/pdf` — professional A4 contract w/ parties, event details, financial breakdown, cancellation policy, digital sig section (~5KB)
  - `GET /api/bookings/{bid}/invoice` — GST tax invoice (~3KB)
  - Both return `application/pdf` with proper `%PDF-` magic bytes
- **Frontend**:
  - BookingFlow loads `https://checkout.razorpay.com/v1/checkout.js` lazily; opens real Razorpay modal when enabled
  - Payment-gateway banner switches between "Razorpay LIVE" and "Test mode" copy
  - Pay button label changes to "Pay ₹X via Razorpay" when live
  - Success screen has Download Invoice button
  - Bookings table now exposes `dl-contract-{id}` / `dl-invoice-{id}` buttons
- Admin role can list all contracts via `/api/contracts/mine`
- **35/35 backend tests passing, full end-to-end booking + invoice download verified**

## How to go live with Razorpay
1. Go to https://dashboard.razorpay.com/ → Account & Settings → API Keys → Generate Test Key
2. Add to `/app/backend/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxx   # only if using webhook
   ```
3. Restart backend: `sudo supervisorctl restart backend`
4. `GET /api/payments/config` now returns `razorpay_enabled: true`
5. Real Razorpay checkout will open in the booking flow
6. Optional webhook URL for Razorpay dashboard: `https://yourdomain.com/api/payments/webhook`

## Known Mocks (highlighted)
- **Razorpay is in MOCK mode** until keys are filled in `.env` (clearly indicated in UI banner)
- **SMS OTP** is MOCKED (always `123456`)
- **KYC verification** — manual admin approval, no document-verification provider integrated
- **Media storage** — base64 in MongoDB (works at MVP scale; consider S3/Cloudinary for production)

## Backlog
### P0 (do next)
- [ ] Add Razorpay live keys to `.env` (user has to provide)
- [ ] Real SMS OTP provider (Twilio/MSG91) for phone verification
- [ ] S3/Cloudinary migration for media

### P1
- [ ] Real-time chat via WebSocket (currently REST polling)
- [ ] Push notifications
- [ ] Digital signature on contracts (signaturepad.js)
- [ ] AI semantic search over artist bios
- [ ] Agency dashboard
- [ ] Counter-offer UI flow on artist side

### P2
- [ ] Analytics charts (recharts)
- [ ] Email notifications (SendGrid/Resend)
- [ ] Referral program
- [ ] 2FA
- [ ] i18n (Hindi + English)

## Test Credentials (see /app/memory/test_credentials.md)
- Admin: `admin@booktalent.com / Admin@123`
- Customer: `customer@booktalent.com / Customer@123`
- Artist: `priya@booktalent.com / Artist@123`
- Mock OTP (used only in mock mode): `123456`
