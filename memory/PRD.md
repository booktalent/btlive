# BookTalent — Product Requirements Document

## Original Problem Statement
Transform the static UI mock into a fully functional, production-ready full-stack marketplace
(React + FastAPI + MongoDB) for booking artists across India. Treat as a premium enterprise
SaaS, not a demo. UI is final — preserve exactly. Only functionality is to be added.

## User Personas
- **Customer** — books artists for events
- **Artist** — creates profile, takes bookings, buys promotions, accepts agency invites
- **Agency** — manages roster of artists, earns commission on roster bookings
- **Corporate** — bulk bookings with cost centres and PO numbers
- **Admin** — full marketplace ERP

## Architecture
- **Backend**: FastAPI + Motor + JWT + WebSocket; routers: `iter7_routes`, `iter9_routes`, `chat_routes`
- **Frontend**: React 18 + React Router; theme PRESERVED, only functionality added
- **Media**: MongoDB binary with Pillow compression + 400×400 thumbs
- **PDF**: ReportLab
- **Notifications engine**: `notification_service.dispatch()` → in_app/email/sms/whatsapp/push
- **Providers** auto-switch from mock → live when env keys set:
  - Resend → `RESEND_API_KEY`
  - Twilio → `TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM`
  - Gupshup WhatsApp → `WHATSAPP_TOKEN + WHATSAPP_FROM`
  - FCM Push → `FCM_SERVER_KEY`
  - Razorpay → `RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET`
  - Stripe → `STRIPE_SECRET_KEY`

## Done
### Iter 1-6
Auth + email OTP, Onboarding wizard, Profile + packages + Media manager (Pillow), Booking flow with counter-offers, Contract PDF, Razorpay (mock), Wallet, Reviews, Customer/Artist/Admin dashboards, dynamic gallery thumbnails on cards.

### Iter 7 — Enterprise
Master data CRUD, FAQs, CMS, System settings, Notification templates, Smart notification engine, Booking auto-notify, Broadcast, Audit logs, Boost system (9 types × 5 durations), Advanced search (13 filters + suggestions + popular + saved + history), Reports (revenue + top artists).

### Iter 8 — Rotation + KYC + Coupon + Chat
- Dynamic Artist Thumbnail Rotation (`ArtistCardThumb` — featured-first, crossfade, hover-pause, IntersectionObserver-gated)
- KYC polish (Aadhaar/PAN regex, file-type whitelist, 5 MB cap, masked storage, 3-decision flow with smart-notification + audit)
- Coupon redemption ledger + analytics (`_validate_coupon`, `db.coupon_redemptions`, per-coupon KPIs, drill-down)
- Live chat via WebSocket (`chat_routes`, typing, ✓/✓✓ read receipts, off-line in-app fallback)

### Iter 9 — P2 (this round)
- **Photo/Video reviews + moderation** — text-only reviews auto-approved, with-media routed to admin queue; aggregate rating only counts approved; reviews with photos (≤5×5MB) + videos (≤2×30MB)
- **Agency dashboard** at `/agency` — Overview KPIs (roster/pending/bookings/GMV/commission), Roster table, Invite form (with commission %), Bookings table; backend invite + accept/decline endpoints
- **Corporate dashboard** at `/corporate` — Overview KPIs (total spend/bookings/cost centres), Bulk Booking multi-row form (artist→package→date+venue+cost centre+PO+headcount), Bookings table, Spend-by-Cost-Centre breakdown
- **ChatBox enhancements** — 📎 file (15 MB cap), 🎤 voice note via MediaRecorder (5 MB cap), 📹 video-call request; new bubble types in chat history
- **Real provider wiring scaffolds** — Twilio, Gupshup, FCM; `/admin/providers/status` shows live/mock state of all 6 providers; `/admin/providers/test/{channel}` lets admin send a test message; notification_service automatically uses real providers when keys present

## Backlog (after iter9)
- Split `server.py` (~2.8k lines) into per-domain routers
- ChatBox WebSocket on multi-replica → Redis pubsub
- ReviewModal e2e Playwright test with real reviewable booking
- Stricter cost-centre + PO validation on /corporate/bulk-bookings
- AI semantic search via Emergent LLM key
- Email_service: render notification_service templates directly through Resend
- ICS calendar attachment on booking confirmation email
- Customer/Agency invoice exports (CSV)

## Key Endpoints (iter9 additions)
| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/reviews` | POST | photos[] + videos[]; auto-moderation logic |
| `/api/admin/reviews?status=...` | GET admin | queue with filter |
| `/api/admin/reviews/{rid}/moderate` | POST admin | approve / reject |
| `/api/agency/invite`, `/agency/roster`, `/agency/invites`, `/agency/invite/{id}/respond`, `/agency/remove/{aid}`, `/agency/bookings`, `/agency/stats` | mixed | agency RBAC |
| `/api/corporate/bulk-bookings`, `/corporate/bookings`, `/corporate/stats` | corporate | |
| `/api/chat/{bid}/upload` | POST auth | file / voice / video-request |
| `/api/admin/providers/status` | GET admin | live/mock for 6 providers |
| `/api/admin/providers/test/{sms\|whatsapp\|push}` | POST admin | mocked when keys absent |

## Test Results
- **iter9**: backend 28/28 new + 22/22 iter8 regression. Frontend 100% on tested surfaces.
- Reports: `/app/test_reports/iteration_5..8.json`
- Test files: `/app/backend/tests/test_iter6.py`, `test_iter7.py`, `test_iter8.py`, `test_iter9.py`

## Test Credentials (also in `/app/memory/test_credentials.md`)
- Admin: `admin@booktalent.com` / `Admin@123`
- Customer: `customer@booktalent.com` / `Customer@123`
- Artist: `priya@booktalent.com` / `Artist@123` (KYC approved)
- Alt artist: `vortex@booktalent.com` / `Artist@123`
- Agency: `agency@booktalent.com` / `Agency@123` (Star Talent Agency)
- Corporate: `corporate@booktalent.com` / `Corporate@123` (Acme Corp)
- Mock OTP: `123456`
