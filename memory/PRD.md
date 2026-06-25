# BookTalent — Product Requirements Document

## Original Problem Statement
Transform the static UI mock into a fully functional, production-ready full-stack marketplace
(React + FastAPI + MongoDB) for booking artists across India. Every placeholder feature,
dummy button, and static page must be wired to real database operations and business logic.
Treat as a premium enterprise SaaS, not a demo.

## User Personas
- **Customer** — books artists for events (weddings, corporate, private parties).
- **Artist** — creates a profile, takes bookings, gets paid, can buy promotion packages.
- **Agency** — manages a roster of artists.
- **Corporate** — books at scale.
- **Admin** — operates the full marketplace ERP.

## Architecture
- Backend: FastAPI + Motor (MongoDB) + JWT
- Frontend: React 18 + React Router + custom dark-luxury theme
- File storage: MongoDB binary with Pillow compression + thumbnail
- PDF: ReportLab
- Email: Resend (mock fallback)
- Payments: Razorpay + Stripe + PayPal (mock fallback)
- New routers: `iter7_routes.py` (enterprise ERP) wired via `app.include_router`

## Modules — Status

### Done
- Auth: email OTP signup, JWT, role-based (customer/artist/agency/admin) ✓
- Onboarding Wizard (5-step) ✓
- Artist Profile + packages + media manager (Pillow compression, replace/reorder/set-featured) ✓
- Dynamic gallery thumbnails on landing/search cards ✓
- Booking flow (5-step) + auto-block dates + counter-offers + alternative artists ✓
- Contract PDF + signed upload + status flips ✓
- Razorpay payments (mock fallback) ✓
- Reviews & ratings ✓
- Wallet (top-up, withdrawals, escrow) ✓
- Customer / Artist / Admin dashboards ✓

### Iteration 7 — Enterprise (Feb 2026)
- **Master Data CRUD** — Categories, Cities, Event Types, Languages (admin editable + public catalogs) ✓
- **FAQs** — admin CRUD + public `/api/faqs` ✓
- **CMS Pages** — about, terms, privacy (admin CRUD + public `/api/cms/{slug}`) ✓
- **System Settings** — key-value (platform_fee_pct, gst_pct, support email/phone) ✓
- **Notification Templates** — email/sms/whatsapp/push/in_app with `{var}` interpolation, admin CRUD ✓
- **Smart Notification Engine** — `notification_service.dispatch()` writes to db.notifications + db.notifications_log; multi-channel with mock fallback when keys absent ✓
- **Booking auto-notify** — customer + artist + admins all get in-app + email on confirmation ✓
- **Broadcast** — admin can blast a notification to any audience (artist/customer/all) on multiple channels ✓
- **Audit Logs** — every admin write is logged with actor/target/payload ✓
- **Boost / Promotion System** — admin-managed packages (9 types × 5 durations), artist purchase via Razorpay/Stripe/PayPal/mock, auto-expiry on `/boost/mine`, auto-revert boost_rank/flags ✓
- **Admin Boost Manager** — packages CRUD, active subscribers, cancel, manual-assign ✓
- **Advanced Search** — filters (category, city, budget, language, gender, rating, experience, event type, featured/verified/premium/instant), sort (relevance/price/rating/newest), pagination, boost_rank ranking ✓
- **Search UX** — type-ahead suggestions, popular queries (last 30d), saved searches, history ✓
- **Reports** — Revenue (GMV/platform/boost), Top Artists by revenue ✓

### Backlog (P1/P2)
- **P1** — KYC approval workflow polish (UI exists; backend stub)
- **P1** — Coupon usage tracking + redemption ledger
- **P1** — Live chat (WebSocket) between customer & artist
- **P2** — Photo/video reviews + moderation
- **P2** — S3/Cloudinary migration for media (currently MongoDB binary)
- **P2** — Push notifications via FCM (channel scaffolded, no key)
- **P2** — Real WhatsApp/SMS via Twilio / Gupshup (channel scaffolded, no key)
- **P2** — Agency dashboard + roster management
- **P2** — Corporate dashboard + bulk booking

### Tech Debt
- `server.py` is 2400+ lines → split into `/app/backend/routes/{auth,booking,media,...}.py`
- React admin components could move to per-feature folders

## Key Endpoints (Iter7 additions)
| Endpoint | Method | Notes |
| --- | --- | --- |
| `/api/catalog/{entity}` | GET | public — categories/cities/event-types/languages |
| `/api/admin/master/{entity}` | GET/POST/PUT/DELETE | admin CRUD |
| `/api/faqs`, `/api/admin/faqs` | public read / admin CRUD | |
| `/api/cms/{slug}`, `/api/admin/cms` | public read / admin CRUD | |
| `/api/admin/settings`, `/api/admin/settings/{key}` | admin | system settings |
| `/api/admin/templates` | admin CRUD | notification templates |
| `/api/admin/notifications/broadcast` | POST | multi-channel blast |
| `/api/admin/notifications/log` | GET | audit channel attempts |
| `/api/admin/audit-logs` | GET | all admin write history |
| `/api/boost/packages`, `/api/boost/purchase`, `/api/boost/mine` | artist | |
| `/api/admin/boost/packages`, `/admin/boost/subscriptions`, `/admin/boost/{id}/cancel`, `/admin/boost/manual-assign` | admin | |
| `/api/search/artists` | GET | full-filter, paginated, boost-ranked |
| `/api/search/suggestions`, `/search/popular`, `/search/saved`, `/search/history` | mixed | |
| `/api/admin/reports/revenue`, `/api/admin/reports/top-artists` | admin | |

## Storage
Media remains in MongoDB binary with Pillow compression (12 MB cap, 400×400 thumbs).
S3/Cloudinary migration deferred to backlog.

## Iter7 Test Results
- Backend: 104/105 pytest pass (30 new iter7 tests + 74 regression).
- Frontend: AdminDashboard Coupons crash fixed (`useEffect(reload, [])` → `useEffect(() => { reload(); }, [])`).
  All 17 sidebar tabs render. Search page renders with 14 cards + advanced filters.
- See `/app/test_reports/iteration_5.json` (audit) and `/app/test_reports/iteration_6.json` (iter7).
