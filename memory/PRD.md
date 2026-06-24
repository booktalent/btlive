# BookTalent — Product Requirements Document

## Original Problem Statement
Build a production-ready BookTalent talent marketplace platform (Indian artist booking) from scratch. User uploaded HTML design references for premium dark luxury theme (gold + purple). Must include real backend workflows — auth, artist profiles with media uploads, package builder, booking workflow end-to-end, payments (simulated Razorpay), wallet & withdrawals, reviews, contracts, KYC, admin panel — not just UI mockups.

## Architecture
- **Backend**: FastAPI (Python) + MongoDB + JWT auth (`bcrypt` + `pyjwt`)
- **Frontend**: React 19 + react-router-dom v7 (client-side routing)
- **Styling**: Custom CSS (no framework) matching the dark luxury HTML reference
- **Media**: base64 stored in MongoDB `media` collection, streamed back via `/api/media/{id}`
- **Payments**: simulated Razorpay-style flow (mock OTP `123456`)

## User Personas
1. **Customer / Event Planner** — books artists for events, manages bookings, leaves reviews
2. **Artist** — manages profile, packages, media, availability; receives bookings; withdraws earnings
3. **Agency** — same as customer but represents multiple artists (data model only)
4. **Corporate** — bulk-booking event planners
5. **Admin** — moderates KYC, releases payouts, manages coupons/blogs/users, resolves disputes

## Core Requirements (delivered ✅)
### Auth
- Email/password registration with role selector (customer/artist/agency/corporate)
- JWT token, `Authorization: Bearer` header
- `/api/auth/me` returns enriched user with artist_profile + wallet
- Mock OTP for SMS (`/api/auth/otp/send`, `/api/auth/otp/verify`)
- Forgot-password endpoint (creates token, logs reset link)
- Seeded admin: `admin@booktalent.com / Admin@123`

### Artist Module
- Profile CRUD (bio, tagline, languages, genres, event types, travel range)
- Packages CRUD (name, price, duration, features, is_popular)
- Media upload (profile, cover, gallery, video, reel, kyc, review) — base64, deletable, feature-toggle, reorder
- Availability calendar (block / free dates) — blocks booking on conflict
- KYC submission + status tracking
- Public profile at `/artist/:id` with tabs: About / Media / Packages / Reviews

### Booking Workflow (full state machine)
- States: `pending_payment → pending_artist → confirmed → started → completed_by_artist → completed → reviewed`
- 5-step UI: Package → Date+Time → Event Details → Review → Payment
- Pricing: package fee + add-ons − coupon + 5% platform fee + 18% GST = total. 5% token paid upfront, balance due before event
- Artist actions: accept, reject (with refund), counter-offer, start, complete
- Customer actions: approve_completion (releases funds), cancel
- Auto contract generation on accept; auto fund release on `approve_completion`
- Booking ref format `BT-YYMMDD-XXXXXX`

### Payment & Wallet
- Mock Razorpay flow with `/api/payments/init` + `/api/payments/verify`
- Wallet per user (balance, pending, total_earned, total_withdrawn)
- Transactions ledger
- Withdrawal request → admin release

### Reviews
- Customer reviews completed bookings (rating + text + photos)
- Aggregates update artist's `rating_avg` and `review_count`
- Artist can reply once; users can report

### Admin Panel
- KPI dashboard (real GMV, platform revenue, escrow, KYC pending, disputes — all computed from DB)
- Artist management (feature / suspend toggles)
- KYC queue (approve / reject with reason)
- Withdrawal release queue
- Coupon CRUD
- All bookings + users view
- Dispute resolution (release to artist / refund / partial)

### Search & Discovery
- Landing page with hero, featured artists, category strip
- `/search` with filters: query, category, city, max price, sort (relevance/rating/popular/newest)
- Pagination support
- Featured / boosted profiles surface first

### Boost / Premium
- 3 plans: Starter (₹999/7d), Pro (₹2499/30d), Elite (₹7499/90d)
- `is_boosted` + `boost_expires` on artist profile

### CMS & Misc
- Blog/CMS endpoints (`/api/blogs`, admin create)
- Notifications system (in-app) on booking events
- Direct messages (`/api/messages` + `/api/conversations`)

## What's been implemented (2026-06-24)
- Backend `server.py` — ~1,700 LOC covering all of the above with seeded demo data (6 artists, 1 customer, 2 coupons)
- Frontend pages: `Landing`, `Auth` (signin+signup), `Search`, `ArtistProfile`, `BookingFlow`, `CustomerDashboard`, `ArtistDashboard`, `AdminDashboard`
- Premium dark luxury theme in `index.css` (Cormorant Garamond + Inter, gold/purple palette, glassmorphism)
- `data-testid` on every interactive element
- Testing agent: **28/28 backend tests passing**, ~95% frontend coverage

## Known Mocks (highlighted)
- **PAYMENT** is fully MOCKED — Razorpay simulator (OTP `123456`). Real Razorpay/Stripe integration must be added for production.
- **SMS OTP** is MOCKED — always `123456`. Real SMS provider (Twilio / MSG91) needed for production.
- **KYC verification** is manual admin approval — no real document verification provider integrated.
- **Media storage** uses base64 in MongoDB — for production scale, migrate to S3/Cloudinary.

## Backlog (P0 / P1 / P2)
### P0 — needed before public launch
- [ ] Real payment gateway (Razorpay or Stripe) replacing mock
- [ ] Real SMS OTP provider for phone verification
- [ ] PDF generation for contracts (`reportlab` or `weasyprint`)
- [ ] S3/Cloudinary migration for media (move off base64 in DB)

### P1 — feature completeness
- [ ] Real-time chat (WebSocket layer; messages exist via REST today)
- [ ] Push notifications (web + mobile)
- [ ] Counter-offer UI flow on artist side
- [ ] Digital signature on contracts (e.g. `signaturepad.js`)
- [ ] AI search (semantic) over artist bios/genres
- [ ] Agency dashboard (manage multiple artists)

### P2 — polish & growth
- [ ] Analytics charts (currently table-based)
- [ ] Email notifications (SendGrid/Resend)
- [ ] Referral program
- [ ] Two-factor auth
- [ ] i18n (Hindi + English)

## Test Credentials (see /app/memory/test_credentials.md)
- Admin: `admin@booktalent.com / Admin@123`
- Customer: `customer@booktalent.com / Customer@123`
- Artist: `priya@booktalent.com / Artist@123`
- Mock OTP: `123456`
