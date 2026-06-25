# BookTalent — Product Requirements Document

## Original Problem Statement
Build a production-ready BookTalent talent marketplace (Indian artist booking) with the premium dark luxury theme. Must include real backend workflows — auth (email verification), artist profiles + rich media, packages, full booking workflow, Razorpay payments, wallet, reviews, PDF contracts/invoices, KYC, admin panel.

## Architecture
- **Backend**: FastAPI + MongoDB + JWT (`bcrypt`, `pyjwt`), Razorpay SDK (`razorpay==1.4.2`), Resend email (`resend==2.32.2`), PDF generation (`reportlab==4.2.0`)
- **Frontend**: React 19 + react-router-dom v7
- **Styling**: Custom dark-luxury CSS (gold + purple, Cormorant Garamond + Inter)
- **Media storage**: base64 in MongoDB (capped at 12 MB binary due to BSON 16 MB doc limit)
- **Payments**: Razorpay live integration with safe mock fallback
- **Email verification**: Resend with safe mock fallback

## User Personas
1. Customer / Event Planner
2. Artist (Instagram-creator-meets-Fiverr-seller-meets-Airbnb-host experience)
3. Agency / Corporate
4. Admin (full marketplace ops)

## Implementation log

### Iteration 1 — MVP
- Auth, artist discovery + filters, profile, 5-step booking, customer/artist/admin dashboards
- Wallet, reviews, KYC, coupons, boost, disputes, notifications, messaging
- 6 seeded demo artists. 28/28 backend tests.

### Iteration 2 — Razorpay + PDFs
- Razorpay integration (`/init`, `/verify` signature, `/webhook` HMAC, `/refund`)
- ReportLab PDF generation (contracts + GST invoices)
- Frontend Razorpay checkout with mock fallback. 35/35 backend tests.

### Iteration 3 — Email Verification
- Resend email-OTP signup (`/auth/email/send`, `/verify`)
- 4-step signup UI: Role → Details → Verify Email → Finish
- Premium dark-luxury HTML email template
- Local storage kept (no Cloudinary). 43/43 backend tests.

### Iteration 4 — Enterprise Artist Module
- **Artist Onboarding Wizard** — 5-step modal that auto-shows for new artists (`/onboarding/me` + `/onboarding/complete` endpoints)
- **Booking confirmation email** auto-sent on artist accept (uses Resend; mock-logs when no key)
- **Auto-block date** when booking is confirmed — `db.availability` upserted to `status='booked'` with the booking_id
- **Smart alternative artists** — when customer tries to book a blocked date, API returns 400 with 3 alternative artists (same category+city → category-only → city-only fallback) + frontend modal
- **Counter-offer flow** — artist counters with new price, customer can accept (locks in price) or reject (reverts), both with notifications
- **Upload signed contract** — `/contracts/upload-signed` for artist/customer; contract flips to `fully_signed` when both upload
- **Expanded media types** — `audio, document, press_kit, brand_deck, clip` accepted; 12 MB binary cap (BSON limit)
- **Rich profile fields** — `awards, certifications, faqs, youtube_url, instagram_url, spotify_url, onboarding_step`
- **Premium HTML emails** — booking confirmation email + OTP email both branded
- **Backend: 64/64 pytest passing** · Frontend E2E (customer booking + artist counter modal) verified via Playwright

## Switching to live integrations (no code change)
Add to `/app/backend/.env`, then `sudo supervisorctl restart backend`:
```env
RESEND_API_KEY=re_xxxxxxxxxxxx
SENDER_EMAIL="BookTalent <noreply@yourdomain.com>"

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxx
```

## Currently MOCKED (highlighted)
- **Email** — `RESEND_API_KEY` empty → OTP returned in API + shown in UI hint
- **Razorpay** — `RAZORPAY_KEY_ID` empty → mock OTP `123456` accepted to confirm bookings
- **Booking confirmation email** — logs to console in mock mode

## Decisions per user
- ✅ Email verification (not SMS)
- ✅ Local storage in MongoDB (base64) — no Cloudinary/S3
- ✅ Razorpay keys dummy/empty — integration wired and ready

## Backlog
### P1
- Real-time chat via WebSocket (currently REST polling)
- Digital-signature pad on contracts (vs. file upload)
- AI semantic search over artist bios
- Agency dashboard (multi-artist management)
- Booking analytics charts (recharts)
- Counter-decision UI on customer side (backend ready; needs button in customer dashboard)
- Wizard auto-show: persist a "skip until X" flag in localStorage
- Hash OTPs at rest + throttle wrong-attempt attempts

### P2
- Email notifications for additional events (review, withdrawal, KYC)
- Referral program
- 2FA
- i18n (Hindi + English)
- Move base64 → GridFS for >12MB media support (or Cloudinary)
- Split server.py (~2300 lines) into routers/

## Test Credentials — see /app/memory/test_credentials.md
- Admin: `admin@booktalent.com / Admin@123`
- Customer: `customer@booktalent.com / Customer@123`
- Artist: `priya@booktalent.com / Artist@123`
- Mock email OTP: `123456`
- Mock payment OTP: `123456`
