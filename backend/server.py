"""
BookTalent — Production-grade Talent Marketplace API
FastAPI + MongoDB + JWT
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import asyncio
import uuid
import logging
import base64
import io
import hmac
import hashlib
import re
import bcrypt
import jwt
import razorpay
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List, Literal, Any, Dict

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from pdf_service import generate_contract_pdf, generate_invoice_pdf
from email_service import (
    is_email_enabled, generate_otp, send_otp_email, send_booking_confirmation_email,
)
from image_service import compress_image, make_thumbnail
from iter7_routes import make_router as make_iter7_router
from iter9_routes import make_router as make_iter9_router
from iter11_routes import make_iter11_router
from chat_routes import make_chat_router
from notification_service import dispatch as notify_dispatch
from routes import reviews as routes_reviews
from routes import coupons as routes_coupons
from routes import blogs as routes_blogs
from routes import disputes as routes_disputes
from routes import kyc as routes_kyc
from routes import uploads as routes_uploads
from routes import addons as routes_addons
from routes import subscriptions as routes_subscriptions
from routes import homepage as routes_homepage
from routes import concierge as routes_concierge
from routes import insights as routes_insights
from routes import city_aliases as routes_city_aliases
from routes import outstation_report as routes_outstation_report
from routes import cms_seo as routes_cms_seo
from routes import questionnaire as routes_questionnaire

# ─────────────────────────────────────────────────────────────────────────────
# Setup
# ─────────────────────────────────────────────────────────────────────────────
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
PLATFORM_FEE_PCT = float(os.environ.get("PLATFORM_FEE_PCT", 5))
GST_PCT = float(os.environ.get("GST_PCT", 18))
TOKEN_PCT = float(os.environ.get("TOKEN_PCT", 5))

# Razorpay setup
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()
RAZORPAY_ENABLED = bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)
razorpay_client = None
if RAZORPAY_ENABLED:
    try:
        razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
        razorpay_client.set_app_details({"title": "BookTalent", "version": "1.0.0"})
    except Exception as _e:
        RAZORPAY_ENABLED = False
        razorpay_client = None

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="BookTalent API")
api = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("booktalent")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def make_token(user_id: str, role: str, exp_hours: int = 24 * 7) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=exp_hours),
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def clean(doc: Optional[dict]) -> Optional[dict]:
    """Remove _id and sensitive fields from a Mongo doc."""
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


def new_id() -> str:
    return str(uuid.uuid4())


def booking_ref() -> str:
    return "BT-" + datetime.now().strftime("%y%m%d") + "-" + uuid.uuid4().hex[:6].upper()


# ─────────────────────────────────────────────────────────────────────────────
# Auth dependency
# ─────────────────────────────────────────────────────────────────────────────
async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.cookies.get("access_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]})
    if not user:
        raise HTTPException(401, "User not found")
    return clean(user)


async def get_current_user_optional(authorization: str | None) -> dict | None:
    """Sprint 5 Smart Homepage — resolve caller if a valid token is present.

    Never raises — returns None for anonymous or invalid-token requests so that
    public endpoints can gracefully fall back to non-personalized output.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]})
        return clean(user) if user else None
    except Exception:
        return None


# ─── httpOnly cookie helpers (defense-in-depth against XSS token theft) ──
# Setting the JWT as an httpOnly cookie prevents JavaScript from reading it,
# which shuts down the classic XSS-token-exfiltration path. The frontend
# still stores the same token in localStorage so WebSocket auth (which can't
# send headers) keeps working via the ?token= query param.
_COOKIE_NAME = "access_token"
_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days — matches JWT expiry


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,
        secure=True,      # HTTPS-only (both Emergent preview + user's VPS are HTTPS)
        samesite="lax",   # allows normal navigation, blocks cross-site CSRF
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=_COOKIE_NAME, path="/")


# ─── City alias canonicalisation (Iter 35) ─────────────────────────────
# Module-level cache — refreshed lazily on the first booking after startup so
# admin edits via /admin/settings/city_aliases don't require a redeploy.
_CITY_ALIAS_MAP: dict = {}


async def _refresh_city_aliases() -> None:
    global _CITY_ALIAS_MAP
    _CITY_ALIAS_MAP = await routes_city_aliases.load_alias_map(db)


def _outstation_check(artist_city: str | None, event_city: str | None, alias_map: dict) -> bool:
    """True when the two cities are DIFFERENT after alias canonicalisation."""
    if not artist_city or not event_city:
        return False
    a = routes_city_aliases.canonical_city(artist_city, alias_map)
    b = routes_city_aliases.canonical_city(event_city, alias_map)
    return a != b


async def require_role(roles: list[str]):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, f"Requires role: {roles}")
        return user
    return _dep


async def admin_only(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return user


# ─── Iter 55 — RBAC helpers ────────────────────────────────────────────────
# Available admin permissions. A super_admin implicitly has all of them.
ADMIN_PERMISSIONS = [
    "admins.manage",       # Create/edit/delete other admins (super admin only)
    "users.view",
    "users.edit",
    "users.suspend",
    "users.delete",
    "artists.moderate",    # verify / feature / suspend artist profiles
    "bookings.view",
    "bookings.override",   # extend/force-accept/reject/refund bookings
    "payments.view",
    "payments.refund",
    "cms.manage",          # blogs, pages, CTAs
    "settings.manage",     # site settings, pricing rules
    "analytics.view",
    "notifications.send",
    "subscriptions.manage",
]

# Preset roles bundled with the seed data. Custom roles can be created via
# the admin UI which just stores a permission array on the user document.
ADMIN_ROLE_PRESETS = {
    "super_admin":    ADMIN_PERMISSIONS,                                # everything
    "operations":     ["users.view", "users.edit", "artists.moderate", "bookings.view",
                       "bookings.override", "payments.view", "analytics.view"],
    "finance":        ["users.view", "bookings.view", "payments.view", "payments.refund",
                       "subscriptions.manage", "analytics.view"],
    "content":        ["users.view", "cms.manage", "notifications.send", "analytics.view"],
    "support":        ["users.view", "bookings.view", "artists.moderate", "notifications.send"],
    "viewer":         ["users.view", "bookings.view", "payments.view", "analytics.view"],
}


def admin_has_permission(admin: dict, permission: str) -> bool:
    """Return True if the admin user has the given permission.
    Super admins (or admins without an explicit permission list — legacy seed)
    are treated as having all permissions."""
    if admin.get("admin_role") == "super_admin":
        return True
    perms = admin.get("admin_permissions")
    # Legacy admins created before RBAC have no admin_permissions field →
    # keep them full-access so we don't break existing installs.
    if perms is None:
        return True
    return permission in perms


def require_permission(permission: str):
    """Dependency factory: `admin: dict = Depends(require_permission('bookings.override'))`.
    Bakes the admin_only check in so route decorators stay one-liner."""
    async def _dep(admin: dict = Depends(admin_only)) -> dict:
        if not admin_has_permission(admin, permission):
            raise HTTPException(403, f"Missing permission: {permission}")
        return admin
    return _dep


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic Models
# ─────────────────────────────────────────────────────────────────────────────
class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    first_name: str
    last_name: str = ""
    phone: str = ""
    role: Literal["customer", "artist", "agency", "corporate"]
    # artist-specific
    category: Optional[str] = None
    city: Optional[str] = None
    # agency / corporate
    company_name: Optional[str] = None


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class OTPBody(BaseModel):
    phone: str
    otp: Optional[str] = None


class UpdateProfileBody(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    bio: Optional[str] = None
    tagline: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    languages: Optional[List[str]] = None
    genres: Optional[List[str]] = None
    event_types: Optional[List[str]] = None
    travel_range: Optional[str] = None
    notice_period_days: Optional[int] = None
    experience_years: Optional[int] = None
    category: Optional[str] = None
    subcategories: Optional[List[str]] = None
    socials: Optional[Dict[str, str]] = None
    available_for_booking: Optional[bool] = None
    stage_name: Optional[str] = None
    bank: Optional[Dict[str, str]] = None
    # rich profile fields
    awards: Optional[List[str]] = None
    certifications: Optional[List[str]] = None
    faqs: Optional[List[Dict[str, str]]] = None  # [{q, a}]
    youtube_url: Optional[str] = None
    instagram_url: Optional[str] = None
    spotify_url: Optional[str] = None
    onboarding_completed: Optional[bool] = None
    onboarding_step: Optional[int] = None
    # customer specific
    company_name: Optional[str] = None


class PackageBody(BaseModel):
    name: str
    description: str = ""
    price: float
    duration: str = ""
    features: List[str] = []
    is_popular: bool = False
    # Sprint 4 — Travel & Accommodation requirements (borne by customer separately)
    travel_required: bool = False
    accommodation_required: bool = False
    hotel_category: Optional[str] = None            # e.g. "3-star", "4-star", "5-star"
    flight_class: Optional[str] = None              # e.g. "economy", "premium-economy", "business"
    team_size: Optional[int] = None                 # number of people to accommodate
    arrival_buffer_days: Optional[int] = None       # days needed before event
    local_transport_required: bool = False
    meals_required: bool = False
    travel_notes: str = ""                          # free-form additional rider notes


class MediaUploadBody(BaseModel):
    """Used for base64 uploads via JSON for convenience."""
    type: Literal[
        "profile", "cover", "gallery", "video", "reel",
        "audio", "document", "press_kit", "brand_deck", "clip",
        "kyc", "review",
    ]
    data_url: str  # data:image/...;base64,XXX
    title: Optional[str] = None
    is_featured: bool = False


class AvailabilityBody(BaseModel):
    date: str  # YYYY-MM-DD
    status: Literal["available", "blocked", "booked", "premium"]
    # For status == "premium" — a multiplier applied to the artist's base package
    # price on this date (e.g. 1.5 for weekend rate, 2.0 for festival dates).
    premium_multiplier: Optional[float] = None
    premium_label: Optional[str] = None  # e.g. "Weekend", "Diwali", "New Year"


class AddonSelection(BaseModel):
    addon_id: str
    quantity: int = 1


class BookingCreate(BaseModel):
    artist_id: str
    package_id: str
    addons: List[str] = []                       # legacy: hardcoded slugs (dhol/anchor/photo/extra-hour)
    addon_selections: List[AddonSelection] = []  # Sprint 3: artist-defined add-ons
    event_date: str
    event_time: str
    event_type: str
    venue: str
    city: str
    guests: Optional[str] = None
    language_pref: Optional[str] = None
    notes: str = ""
    # Iter 36 — Customer-facing free-text field for outstation asks,
    # dietary requirements, green-room needs etc. Persisted to booking doc,
    # surfaced to artist + printed in the contract PDF.
    special_instructions: str = ""
    coupon_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None
    # Iter 44 — Multi-Artist Event support. If provided, the new booking is
    # attached to an existing event umbrella so a single "Booking Recap" page
    # can render every artist the customer hired for that event. Ownership is
    # enforced: the event_id must belong to another booking of the same user.
    event_id: Optional[str] = None
    # Iter 52.5 — Optional travel allowance the customer commits to pay the
    # artist direct-to-artist. Snapshotted to booking + contract PDF. The
    # platform never handles this money — it exists for auditability only.
    customer_travel_allowance: Optional[float] = 0
    # Iter 52.5 — Terms & Conditions declaration checkbox from the Review step.
    # We reject the booking if this is False so the acceptance is captured
    # in-flow (audit trail).
    tnc_accepted: bool = False


class BookingStatusUpdate(BaseModel):
    # Counter-offer flow removed — BookTalent enforces a fixed-pricing
    # lead-generation model. Artists can only accept or reject.
    action: Literal["accept", "reject", "start", "complete", "approve_completion", "cancel"]
    reason: Optional[str] = None


class PaymentInitBody(BaseModel):
    booking_id: str
    method: Literal["card", "upi", "netbanking"]


class PaymentVerifyBody(BaseModel):
    booking_id: str
    payment_id: str
    # mock-mode fields
    mock_otp: Optional[str] = "123456"
    # Razorpay live fields
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


class ReviewBody(BaseModel):
    booking_id: str
    rating: int = Field(ge=1, le=5)
    text: str
    photos: List[str] = []  # data urls — images
    videos: List[str] = []  # data urls — short clips (≤ 30 MB)


class ReviewReplyBody(BaseModel):
    reply: str


class ReviewModerateBody(BaseModel):
    decision: Literal["approve", "reject"]
    reason: Optional[str] = None


class MessageBody(BaseModel):
    to_user_id: str
    text: str
    booking_id: Optional[str] = None


class CouponBody(BaseModel):
    code: str
    description: str = ""
    discount_type: Literal["percent", "flat"]
    discount_value: float
    max_uses: int = 1000
    per_user_limit: int = 1
    expires_at: str  # YYYY-MM-DD
    min_order: float = 0
    applies_to: str = "all"  # all/wedding/corporate/category-slug
    active: bool = True


class BlogBody(BaseModel):
    title: str
    slug: str
    content: str
    cover_image: Optional[str] = None
    excerpt: str = ""
    tags: List[str] = []
    published: bool = True


class NotificationBody(BaseModel):
    user_id: str
    type: str
    title: str
    body: str


class BoostBody(BaseModel):
    plan: Literal["starter", "pro", "elite"]


class KYCSubmitBody(BaseModel):
    aadhaar_number: Optional[str] = None       # raw 12-digit Aadhaar number
    pan_number: Optional[str] = None           # raw PAN like ABCDE1234F
    full_name: Optional[str] = None
    dob: Optional[str] = None                  # YYYY-MM-DD
    aadhaar: Optional[str] = None              # data url — Aadhaar doc image/pdf
    pan: Optional[str] = None                  # data url — PAN doc image/pdf
    bank_proof: Optional[str] = None           # data url — cancelled cheque / passbook
    selfie: Optional[str] = None               # data url — live selfie for face-match


class KYCDecideBody(BaseModel):
    artist_id: str
    decision: Literal["approve", "reject", "request_resubmission"]
    reason: Optional[str] = None


class DisputeBody(BaseModel):
    booking_id: str
    reason: str
    description: str = ""


class DisputeResolveBody(BaseModel):
    decision: Literal["refund", "release", "partial"]
    amount: Optional[float] = None
    note: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/auth/register")
async def register(body: RegisterBody, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")

    # Require prior email verification via /api/auth/email/verify
    email_otp = await db.email_otps.find_one({"email": email})
    if not email_otp or not email_otp.get("verified"):
        raise HTTPException(400, "Please verify your email first")
    # Consume the OTP record so the same verified token can't be reused later
    await db.email_otps.delete_one({"email": email})

    uid = new_id()
    now = utcnow()
    user_doc = {
        "id": uid,
        "email": email,
        "password_hash": hash_password(body.password),
        "first_name": body.first_name,
        "last_name": body.last_name,
        "phone": body.phone,
        "role": body.role,
        "kyc_status": "unverified",
        "verified": True,
        "email_verified": True,
        "created_at": now,
        "updated_at": now,
        "company_name": body.company_name,
    }
    await db.users.insert_one(user_doc)

    # Create role-specific profile
    if body.role == "artist":
        await db.artist_profiles.insert_one({
            "id": new_id(),
            "user_id": uid,
            "stage_name": f"{body.first_name} {body.last_name}".strip(),
            "category": body.category or "Vocalist",
            "subcategories": [],
            "city": body.city or "",
            "state": "",
            "country": "India",
            "bio": "",
            "tagline": "",
            "languages": [],
            "genres": [],
            "event_types": [],
            "travel_range": "Pan India",
            "experience_years": 0,
            "notice_period_days": 7,
            "available_for_booking": True,
            "profile_image": None,
            "cover_image": None,
            "socials": {},
            "rating_avg": 0,
            "review_count": 0,
            "events_done": 0,
            "followers": 0,
            "profile_views": 0,
            "is_featured": False,
            "is_boosted": False,
            "boost_expires": None,
            "kyc_status": "unverified",
            "created_at": now,
            "updated_at": now,
        })
    elif body.role == "agency":
        await db.agencies.insert_one({
            "id": new_id(),
            "user_id": uid,
            "name": body.company_name or f"{body.first_name} Agency",
            "city": body.city or "",
            "created_at": now,
        })

    token = make_token(uid, body.role)
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    _set_auth_cookie(response, token)
    return {"token": token, "user": user_doc}


@api.post("/auth/login")
async def login(body: LoginBody, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(user["id"], user["role"])
    _set_auth_cookie(response, token)
    return {"token": token, "user": clean(user)}


@api.post("/auth/logout")
async def logout(response: Response):
    """Clear the httpOnly auth cookie. The frontend must also clear localStorage."""
    _clear_auth_cookie(response)
    return {"ok": True}


@api.get("/auth/config")
async def auth_config():
    """Public config — frontend uses this to know whether to show 'test OTP' hint."""
    return {
        "email_provider_enabled": is_email_enabled(),
    }


@api.post("/auth/otp/send")
async def otp_send(body: OTPBody):
    # mock OTP — always 123456
    await db.otps.update_one(
        {"phone": body.phone},
        {"$set": {"otp": "123456", "expires_at": utcnow(), "verified": False}},
        upsert=True,
    )
    return {"sent": True, "test_otp": "123456"}


@api.post("/auth/otp/verify")
async def otp_verify(body: OTPBody, response: Response):
    rec = await db.otps.find_one({"phone": body.phone})
    if not rec or body.otp != "123456":
        raise HTTPException(400, "Invalid OTP")
    # if user exists, log them in. Otherwise return verified flag.
    user = await db.users.find_one({"phone": body.phone})
    if user:
        token = make_token(user["id"], user["role"])
        _set_auth_cookie(response, token)
        return {"verified": True, "token": token, "user": clean(user)}
    return {"verified": True, "token": None}


# ─── Email verification ────────────────────────────────────────────────
class EmailOTPSendBody(BaseModel):
    email: EmailStr
    name: Optional[str] = ""


class EmailOTPVerifyBody(BaseModel):
    email: EmailStr
    otp: str


@api.post("/auth/email/send")
async def email_otp_send(body: EmailOTPSendBody):
    email = body.email.lower()

    # 60-second cooldown
    existing = await db.email_otps.find_one({"email": email})
    if existing:
        try:
            sent_at = datetime.fromisoformat(existing.get("sent_at", utcnow()))
        except Exception:
            sent_at = datetime.now(timezone.utc)
        if (datetime.now(timezone.utc) - sent_at) < timedelta(seconds=60):
            raise HTTPException(429, "Please wait 60 seconds before requesting a new code")

    otp = generate_otp()
    expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    name = body.name or ""
    # If a user already exists, prefer their stored name
    u = await db.users.find_one({"email": email})
    if u and not name:
        name = (u.get("first_name") or "").strip()

    await db.email_otps.update_one(
        {"email": email},
        {"$set": {
            "email": email, "otp": otp,
            "sent_at": utcnow(), "expires_at": expires,
            "verified": False, "attempts": (existing.get("attempts", 0) + 1) if existing else 1,
        }},
        upsert=True,
    )
    result = await send_otp_email(email, otp, name)
    return {
        "sent": result.get("sent", False),
        "mock": result.get("mock", False),
        # In mock mode, expose the OTP so the user can complete signup without an inbox
        "test_otp": otp if not is_email_enabled() else None,
    }


@api.post("/auth/email/verify")
async def email_otp_verify(body: EmailOTPVerifyBody):
    email = body.email.lower()
    rec = await db.email_otps.find_one({"email": email})
    if not rec:
        raise HTTPException(400, "No verification code requested for this email")
    # Expiry check
    try:
        expires = datetime.fromisoformat(rec.get("expires_at", utcnow()))
    except Exception:
        expires = datetime.now(timezone.utc)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(400, "Code expired — please request a new one")
    if str(rec.get("otp")) != str(body.otp).strip():
        raise HTTPException(400, "Invalid code")

    await db.email_otps.update_one(
        {"email": email}, {"$set": {"verified": True, "verified_at": utcnow()}},
    )
    # If a user already exists with this email, mark them verified and issue a token
    user = await db.users.find_one({"email": email})
    if user:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"email_verified": True, "verified": True}},
        )
        token = make_token(user["id"], user["role"])
        user["email_verified"] = True
        return {"verified": True, "token": token, "user": clean(user)}
    # Just verified the email — caller will use it to complete signup
    return {"verified": True, "token": None}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    # enrich with profile
    if user["role"] == "artist":
        prof = await db.artist_profiles.find_one({"user_id": user["id"]})
        user["artist_profile"] = clean(prof) if prof else None
    return user


@api.post("/auth/forgot-password")
async def forgot_password(body: dict):
    email = body.get("email", "").lower()
    u = await db.users.find_one({"email": email})
    if u:
        token = new_id()
        await db.password_resets.insert_one({
            "id": token, "user_id": u["id"], "expires_at": utcnow(), "used": False,
        })
        log.info(f"Password reset link: /reset-password?token={token}")
    return {"sent": True}  # never reveal whether email exists


# ─────────────────────────────────────────────────────────────────────────────
# USER / PROFILE
# ─────────────────────────────────────────────────────────────────────────────
@api.put("/users/me")
async def update_me(body: UpdateProfileBody, user: dict = Depends(get_current_user)):
    update_user = {}
    update_artist = {}
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is None:
            continue
        if k in ("first_name", "last_name", "phone", "company_name"):
            update_user[k] = v
        else:
            update_artist[k] = v
    if update_user:
        update_user["updated_at"] = utcnow()
        await db.users.update_one({"id": user["id"]}, {"$set": update_user})
    if update_artist and user["role"] == "artist":
        update_artist["updated_at"] = utcnow()
        await db.artist_profiles.update_one({"user_id": user["id"]}, {"$set": update_artist})
        # Keep the SEO slug in sync when stage_name/category/city changes
        if any(k in update_artist for k in ("stage_name", "category", "city")):
            from routes.cms_seo import artist_slug as _mk_slug
            prof = await db.artist_profiles.find_one({"user_id": user["id"]}) or {}
            if prof.get("stage_name"):
                await db.artist_profiles.update_one(
                    {"user_id": user["id"]},
                    {"$set": {"slug": _mk_slug(prof)}},
                )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# ARTIST ONBOARDING
# ─────────────────────────────────────────────────────────────────────────────
class OnboardingStepBody(BaseModel):
    step: int  # 1..5
    completed: Optional[bool] = False


@api.get("/onboarding/me")
async def get_onboarding_status(user: dict = Depends(get_current_user)):
    if user["role"] != "artist":
        return {"required": False, "completed": True}
    profile = await db.artist_profiles.find_one({"user_id": user["id"]}) or {}
    media_count = await db.media.count_documents({"user_id": user["id"], "type": {"$in": ["profile", "cover", "gallery"]}})
    pkg_count = await db.packages.count_documents({"artist_id": user["id"]})
    avail_count = await db.availability.count_documents({"user_id": user["id"]})

    checks = {
        "step1_basic": bool(profile.get("stage_name") and profile.get("category") and profile.get("city")),
        "step2_branding": bool(profile.get("bio") and (profile.get("languages") or [])),
        "step3_media": media_count > 0,
        "step4_packages": pkg_count > 0,
        "step5_availability": avail_count > 0,
    }
    done = all(checks.values()) or profile.get("onboarding_completed", False)
    next_step = next((i + 1 for i, k in enumerate(checks.keys()) if not checks[k]), 6)
    return {
        "required": True,
        "completed": done,
        "next_step": next_step,
        "checks": checks,
        "current_step": profile.get("onboarding_step", next_step),
    }


@api.post("/onboarding/complete")
async def complete_onboarding(user: dict = Depends(get_current_user)):
    if user["role"] != "artist":
        raise HTTPException(403, "Artists only")
    await db.artist_profiles.update_one(
        {"user_id": user["id"]},
        {"$set": {"onboarding_completed": True, "onboarding_completed_at": utcnow()}},
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# MEDIA — base64 stored in GridFS-like collection
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/media/upload")
async def media_upload(body: MediaUploadBody, user: dict = Depends(get_current_user)):
    # parse data url
    if not body.data_url.startswith("data:"):
        raise HTTPException(400, "Invalid data URL")
    try:
        header, b64 = body.data_url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "") or "application/octet-stream"
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(400, f"Could not decode file: {e}")
    MAX_BINARY = 12 * 1024 * 1024
    if len(raw) > MAX_BINARY:
        raise HTTPException(413, f"File too large for local storage (max {MAX_BINARY // (1024*1024)} MB binary). Please use a smaller file or host externally.")

    original_size = len(raw)
    thumb_b64 = None
    video_stats: dict = {}
    if mime.startswith("image/"):
        # Compress original (reduces JPEG to ~30% of original on average)
        try:
            raw, mime = compress_image(raw, mime)
        except Exception as _e:
            log.warning("compress_image failed: %s", _e)
        # Generate thumbnail (square 400x400)
        try:
            tbytes, _tmime = make_thumbnail(raw, mime)
            if tbytes:
                thumb_b64 = base64.b64encode(tbytes).decode()
        except Exception as _e:
            log.warning("make_thumbnail failed: %s", _e)
    elif mime.startswith("video/"):
        # Iter 50 — FFmpeg pipeline. Re-encodes to 720p H.264 CRF 28 when the
        # file is >2 MB, keeping perceptual quality but shedding 30-70% size.
        try:
            from video_compression import compress_video_bytes  # noqa: WPS433
            raw, video_stats = await compress_video_bytes(raw=raw)
        except Exception as _e:
            log.warning("compress_video_bytes failed: %s", _e)

    final_b64 = base64.b64encode(raw).decode()
    mid = new_id()
    doc = {
        "id": mid,
        "user_id": user["id"],
        "type": body.type,
        "mime": mime,
        "size": len(raw),
        "original_size": original_size,
        "title": body.title,
        "is_featured": body.is_featured,
        "data": final_b64,  # compressed base64
        "thumb": thumb_b64,  # 400x400 base64 jpeg (None for non-images)
        "order": 0,
        "created_at": utcnow(),
        **({f"video_{k}": v for k, v in video_stats.items()} if video_stats else {}),
    }
    await db.media.insert_one(doc)

    # Convenience: if profile/cover, set on artist profile and remove the previous one
    if user["role"] == "artist" and body.type in ("profile", "cover"):
        key = "profile_image" if body.type == "profile" else "cover_image"
        existing = await db.artist_profiles.find_one({"user_id": user["id"]})
        old_id = (existing or {}).get(key)
        if old_id and old_id != mid:
            await db.media.delete_one({"id": old_id})
        await db.artist_profiles.update_one(
            {"user_id": user["id"]},
            {"$set": {key: mid, "updated_at": utcnow()}},
        )

    # never return the raw data field
    doc.pop("data", None)
    doc.pop("thumb", None)
    doc.pop("_id", None)
    return doc


@api.get("/media/{media_id}/thumb")
async def media_thumb(media_id: str):
    doc = await db.media.find_one({"id": media_id})
    if not doc:
        raise HTTPException(404, "Not found")
    # New filesystem-stored media (Sprint 2 chunked uploads) — serve the JPEG thumb from disk
    if doc.get("storage") == "filesystem" and doc.get("thumb_path"):
        from pathlib import Path as _P
        tp = _P(doc["thumb_path"])
        if tp.exists():
            return FileResponse(tp, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})
    # Legacy base64-in-Mongo media path
    if doc.get("thumb"):
        raw = base64.b64decode(doc["thumb"])
        return StreamingResponse(io.BytesIO(raw), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})
    # Fall back to original (non-image types still go through here)
    raw = base64.b64decode(doc.get("data", ""))
    return StreamingResponse(io.BytesIO(raw), media_type=doc.get("mime", "application/octet-stream"))


@api.put("/media/{media_id}")
async def media_replace(media_id: str, body: MediaUploadBody, user: dict = Depends(get_current_user)):
    """Replace an existing media item's binary while preserving its id + order + featured flag."""
    existing = await db.media.find_one({"id": media_id})
    if not existing:
        raise HTTPException(404, "Not found")
    if existing["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Forbidden")

    if not body.data_url.startswith("data:"):
        raise HTTPException(400, "Invalid data URL")
    try:
        header, b64 = body.data_url.split(",", 1)
        mime = header.split(";")[0].replace("data:", "") or "application/octet-stream"
        raw = base64.b64decode(b64)
    except Exception as e:
        raise HTTPException(400, f"Could not decode file: {e}")
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 12 MB binary).")

    original_size = len(raw)
    thumb_b64 = None
    if mime.startswith("image/"):
        try:
            raw, mime = compress_image(raw, mime)
        except Exception:
            pass
        try:
            tbytes, _ = make_thumbnail(raw, mime)
            if tbytes:
                thumb_b64 = base64.b64encode(tbytes).decode()
        except Exception:
            pass

    await db.media.update_one(
        {"id": media_id},
        {"$set": {
            "mime": mime,
            "size": len(raw),
            "original_size": original_size,
            "data": base64.b64encode(raw).decode(),
            "thumb": thumb_b64,
            "title": body.title or existing.get("title"),
            "updated_at": utcnow(),
        }},
    )
    # If profile/cover, bump the profile updated_at for cache busting
    if user["role"] == "artist" and existing.get("type") in ("profile", "cover"):
        await db.artist_profiles.update_one(
            {"user_id": user["id"]}, {"$set": {"updated_at": utcnow()}},
        )
    return {"ok": True, "id": media_id, "size": len(raw)}


@api.get("/media/{media_id}")
async def media_get(media_id: str):
    doc = await db.media.find_one({"id": media_id})
    if not doc:
        raise HTTPException(404, "Not found")
    raw = base64.b64decode(doc["data"])
    return StreamingResponse(io.BytesIO(raw), media_type=doc.get("mime", "application/octet-stream"))


@api.get("/media")
async def media_list(
    type: Optional[str] = None,
    user_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    q = {"user_id": user_id or user["id"]}
    if type:
        q["type"] = type
    items = await db.media.find(q, {"data": 0}).sort("order", 1).to_list(500)
    return [clean(x) for x in items]


@api.get("/public/media")
async def public_media_list(user_id: str, type: Optional[str] = None):
    q = {"user_id": user_id}
    if type:
        q["type"] = type
    items = await db.media.find(q, {"data": 0}).sort("order", 1).to_list(500)
    return [clean(x) for x in items]


@api.delete("/media/{media_id}")
async def media_delete(media_id: str, user: dict = Depends(get_current_user)):
    doc = await db.media.find_one({"id": media_id})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Forbidden")
    await db.media.delete_one({"id": media_id})
    return {"ok": True}


@api.post("/media/{media_id}/feature")
async def media_feature(media_id: str, user: dict = Depends(get_current_user)):
    doc = await db.media.find_one({"id": media_id})
    if not doc or doc["user_id"] != user["id"]:
        raise HTTPException(404, "Not found")
    await db.media.update_one({"id": media_id}, {"$set": {"is_featured": not doc.get("is_featured", False)}})
    return {"ok": True}


@api.post("/media/reorder")
async def media_reorder(body: dict, user: dict = Depends(get_current_user)):
    ids = body.get("ids", [])
    for i, mid in enumerate(ids):
        await db.media.update_one({"id": mid, "user_id": user["id"]}, {"$set": {"order": i}})
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# ARTIST DISCOVERY / SEARCH
# ─────────────────────────────────────────────────────────────────────────────
@api.get("/artists/search")
async def artists_search(
    q: Optional[str] = None,
    category: Optional[str] = None,
    city: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    language: Optional[str] = None,
    sort: str = "relevance",
    page: int = 1,
    limit: int = 12,
):
    query: dict = {"suspended": {"$ne": True}}
    if category:
        query["category"] = category
    if city:
        query["city"] = city
    if language:
        query["languages"] = language
    if q:
        query["$or"] = [
            {"stage_name": {"$regex": q, "$options": "i"}},
            {"bio": {"$regex": q, "$options": "i"}},
            {"category": {"$regex": q, "$options": "i"}},
        ]

    sort_field = {
        "newest": ("created_at", -1),
        "rating": ("rating_avg", -1),
        "popular": ("events_done", -1),
        "relevance": ("is_boosted", -1),
    }.get(sort, ("is_boosted", -1))

    total = await db.artist_profiles.count_documents(query)
    docs = await db.artist_profiles.find(query).sort([sort_field, ("rating_avg", -1)]).skip((page - 1) * limit).limit(limit).to_list(limit)

    out = []
    for p in docs:
        p = clean(p)
        pkgs = await db.packages.find({"artist_id": p["user_id"]}).to_list(20)
        if pkgs:
            p["starting_price"] = min(float(pp.get("price", 0)) for pp in pkgs)
            p["packages_count"] = len(pkgs)
        else:
            p["starting_price"] = None
            p["packages_count"] = 0
        if min_price is not None and (p["starting_price"] is None or p["starting_price"] < min_price):
            continue
        if max_price is not None and (p["starting_price"] is None or p["starting_price"] > max_price):
            continue
        # Gallery thumbs for dynamic-thumbnail rotation
        gallery = await db.media.find(
            {"user_id": p["user_id"], "type": "gallery"},
            {"data": 0, "thumb": 0},
        ).sort([("is_featured", -1), ("order", 1)]).limit(8).to_list(8)
        p["gallery_thumbs"] = [{"id": g["id"], "is_featured": g.get("is_featured", False)} for g in gallery]
        out.append(p)
    return {"total": total, "page": page, "items": out}


@api.get("/artists/featured")
async def artists_featured(limit: int = 8):
    base = {"suspended": {"$ne": True}}
    docs = await db.artist_profiles.find({**base, "$or": [{"is_featured": True}, {"is_boosted": True}]}).limit(limit).to_list(limit)
    if len(docs) < limit:
        extra = await db.artist_profiles.find({**base, "is_featured": {"$ne": True}}).sort("rating_avg", -1).limit(limit - len(docs)).to_list(limit)
        docs.extend(extra)
    out = []
    for p in docs:
        p = clean(p)
        pkgs = await db.packages.find({"artist_id": p["user_id"]}).to_list(20)
        p["starting_price"] = min((float(pp.get("price", 0)) for pp in pkgs), default=None)
        gallery = await db.media.find(
            {"user_id": p["user_id"], "type": "gallery"},
            {"data": 0, "thumb": 0},
        ).sort([("is_featured", -1), ("order", 1)]).limit(8).to_list(8)
        p["gallery_thumbs"] = [{"id": g["id"], "is_featured": g.get("is_featured", False)} for g in gallery]
        out.append(p)
    return out


@api.get("/artists/{user_id}")
async def artist_detail(user_id: str):
    prof = await db.artist_profiles.find_one({"user_id": user_id})
    if not prof:
        raise HTTPException(404, "Artist not found")
    # Iter 52.8 — suspended artists must not be reachable via the public
    # profile URL either (deep-links, share links, cached SEO cards).
    if prof.get("suspended"):
        raise HTTPException(404, "Artist not found")
    # increment view counter (best-effort)
    await db.artist_profiles.update_one({"user_id": user_id}, {"$inc": {"profile_views": 1}})
    prof = clean(prof)
    user = await db.users.find_one({"id": user_id})
    packages = await db.packages.find({"artist_id": user_id}).sort("price", 1).to_list(50)
    media = await db.media.find({"user_id": user_id, "type": {"$in": ["gallery", "video", "reel", "profile", "cover"]}}, {"data": 0}).to_list(200)
    reviews = await db.reviews.find({"artist_id": user_id, "moderated": {"$ne": "rejected"}}).sort("created_at", -1).limit(20).to_list(20)
    availability = await db.availability.find({"user_id": user_id}).to_list(200)
    return {
        "profile": prof,
        "user": clean(user),
        "packages": [clean(p) for p in packages],
        "media": [clean(m) for m in media],
        "reviews": [clean(r) for r in reviews],
        "availability": [clean(a) for a in availability],
    }


# ─────────────────────────────────────────────────────────────────────────────
# PACKAGES
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/packages")
async def create_package(body: PackageBody, user: dict = Depends(get_current_user)):
    if user["role"] != "artist":
        raise HTTPException(403, "Artists only")
    doc = body.model_dump()
    doc.update({"id": new_id(), "artist_id": user["id"], "created_at": utcnow()})
    await db.packages.insert_one(doc)
    return clean(doc)


@api.get("/packages/mine")
async def list_my_packages(user: dict = Depends(get_current_user)):
    docs = await db.packages.find({"artist_id": user["id"]}).sort("price", 1).to_list(50)
    return [clean(d) for d in docs]


@api.put("/packages/{pid}")
async def update_package(pid: str, body: PackageBody, user: dict = Depends(get_current_user)):
    res = await db.packages.update_one({"id": pid, "artist_id": user["id"]}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/packages/{pid}")
async def delete_package(pid: str, user: dict = Depends(get_current_user)):
    await db.packages.delete_one({"id": pid, "artist_id": user["id"]})
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# AVAILABILITY
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/availability")
async def set_availability(body: AvailabilityBody, user: dict = Depends(get_current_user)):
    update_doc = {
        "id": new_id(), "user_id": user["id"], "date": body.date, "status": body.status,
    }
    if body.status == "premium":
        update_doc["premium_multiplier"] = float(body.premium_multiplier or 1.5)
        update_doc["premium_label"] = body.premium_label or "Premium date"
    await db.availability.update_one(
        {"user_id": user["id"], "date": body.date},
        {"$set": update_doc},
        upsert=True,
    )
    return {"ok": True}


@api.delete("/availability/{date_str}")
async def clear_availability(date_str: str, user: dict = Depends(get_current_user)):
    await db.availability.delete_one({"user_id": user["id"], "date": date_str})
    return {"ok": True}


@api.get("/availability/mine")
async def my_availability(user: dict = Depends(get_current_user)):
    docs = await db.availability.find({"user_id": user["id"]}).to_list(500)
    return [clean(d) for d in docs]


@api.get("/artists/{user_id}/availability")
async def artist_availability(user_id: str, from_date: Optional[str] = None, to_date: Optional[str] = None):
    """
    Public read of an artist's blocked/booked/premium dates for the given range.
    Used by the profile calendar + booking date-picker so customers see live
    availability and any weekend/festival premium pricing.
    """
    q: dict = {"user_id": user_id, "status": {"$in": ["blocked", "booked", "premium"]}}
    if from_date and to_date:
        q["date"] = {"$gte": from_date, "$lte": to_date}
    elif from_date:
        q["date"] = {"$gte": from_date}
    docs = await db.availability.find(q).to_list(1000)
    blocked = sorted({d.get("date") for d in docs if d.get("status") in ("blocked", "booked") and d.get("date")})
    premium = [
        {"date": d["date"], "multiplier": d.get("premium_multiplier", 1.5), "label": d.get("premium_label", "Premium")}
        for d in docs if d.get("status") == "premium" and d.get("date")
    ]
    premium.sort(key=lambda x: x["date"])
    return {"blocked_dates": blocked, "premium_dates": premium, "count": len(blocked) + len(premium)}


@api.get("/artists/{user_id}/quote")
async def artist_quote(user_id: str, city: str):
    """
    Pre-flight venue check for the artist profile "Where's your event?" prompt.

    Returns whether the given event city is outstation for this artist (using
    the canonical city-alias map so Bombay/Mumbai count as the same city),
    plus the packages with an outstation surcharge applied when relevant so
    the customer sees the *right* price BEFORE hitting Book Now.

    Contract:
      GET /api/artists/{user_id}/quote?city=Mumbai
      →  {
           artist_city: "Mumbai",
           event_city:  "Mumbai",
           is_outstation: false,
           outstation_multiplier: 1.0,
           outstation_notice: "…",              (only when outstation)
           packages: [{id, name, base_price, quoted_price, ...}]
         }

    Business rules:
      * `outstation_multiplier` comes from admin/settings public payload
        (`outstation_price_multiplier`, default 1.15 — a 15% surcharge to
        absorb higher-effort quoting). Falls back to 1.0 if the setting is
        absent, so the endpoint stays backward-compatible.
      * The multiplier is APPLIED to `base_price` to produce `quoted_price`.
        The customer sees quoted_price on the artist card; the booking flow
        still stores base_price + will let them add explicit TA / rider costs
        on the review step (Iter 52.5 additions).
    """
    if not city or not city.strip():
        raise HTTPException(400, "city is required")

    profile = await db.artist_profiles.find_one({"user_id": user_id})
    if not profile:
        raise HTTPException(404, "Artist not found")
    # Iter 52.8 — suspended artists cannot be quoted either.
    if profile.get("suspended"):
        raise HTTPException(404, "Artist not found")

    if not _CITY_ALIAS_MAP:
        await _refresh_city_aliases()

    artist_city = profile.get("city")
    is_out = _outstation_check(artist_city, city, _CITY_ALIAS_MAP)

    settings = await db.settings.find_one({"key": "platform"}) or {}
    multiplier = float(settings.get("outstation_price_multiplier") or 1.0) if is_out else 1.0
    notice = settings.get("outstation_notice") or (
        "Travel, accommodation, local transportation, meals, hospitality, and any other "
        "outstation expenses are NOT included in the Artist Package Fee. Please arrange "
        "these directly with the artist."
    )

    # Package list — apply the outstation multiplier for a quoted display price.
    pkgs_out: list[dict] = []
    async for p in db.packages.find({"artist_id": user_id}).sort("price", 1):
        base = float(p.get("price") or 0)
        pkgs_out.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "duration": p.get("duration"),
            "description": p.get("description"),
            "is_popular": bool(p.get("is_popular")),
            "base_price": base,
            "quoted_price": round(base * multiplier, 2),
            "travel_required": bool(p.get("travel_required")),
            "accommodation_required": bool(p.get("accommodation_required")),
        })

    # Iter 52.7 — Distil the Travel & Hospitality rider from the answers the
    # artist already filled in during onboarding (`profile.answers`). This is
    # what the customer sees BEFORE confirming an outstation booking, so no
    # duplicate input is asked of the artist elsewhere.
    ans = (profile.get("answers") or {}) if isinstance(profile.get("answers"), dict) else {}
    def _first(*keys):
        for k in keys:
            v = ans.get(k)
            if v not in (None, "", [], {}): return v
        return None
    hosp = _first("hospitality_needs") or []
    if isinstance(hosp, str):
        hosp = [x.strip() for x in hosp.split(",") if x.strip()]
    food_prefs = [h for h in hosp if h in ("Vegetarian Meal", "Non-Vegetarian Meal", "Jain Meal")]

    rider = {
        "travel_modes":    _first("travel_modes") or [],
        "flight_class":    _first("flight_class"),
        "local_transport": _first("local_transport") or _first("pickup_required"),
        "hotel_required":  _first("hotel_required"),
        "hotel_category":  _first("hotel_category"),
        "rooms_required":  _first("rooms_required") or _first("travel_party_size"),
        "food_preference": ", ".join(food_prefs) if food_prefs else _first("food_preference"),
        "hospitality_needs": hosp,
        "green_room_required": ("Green Room" in hosp) or bool(_first("separate_green_rooms")),
        "sound_provider":  _first("sound_provider"),
        "sound_details":   _first("sound_details", "sound_requirements"),
        "light_details":   _first("light_details", "light_requirements", "own_lighting"),
        "technical_notes": _first("technical_notes"),
        "travel_notes":    _first("travel_notes"),
        "travel_who_pays": _first("travel_who_pays"),
        "additional_conditions": _first("additional_conditions", "other_conditions"),
    }
    # Also snapshot which entries actually have content so the FE can render
    # empty-state gracefully.
    rider["has_any"] = any(
        (v if not isinstance(v, list) else len(v) > 0)
        for k, v in rider.items() if k != "has_any"
    )

    return {
        "artist_id": user_id,
        "artist_city": artist_city,
        "event_city": city.strip(),
        "is_outstation": is_out,
        "outstation_multiplier": multiplier,
        "outstation_surcharge_pct": round((multiplier - 1) * 100, 2) if is_out else 0,
        "outstation_notice": notice if is_out else "",
        "packages": pkgs_out,
        "rider": rider,   # ← Travel & Hospitality snapshot from questionnaire
    }




@api.get("/artists/{user_id}/suggested")
async def artist_suggested(user_id: str, date_str: Optional[str] = None, limit: int = 4):
    """
    Complementary artists for cross-selling during the booking flow.
    Rule of thumb: same city, DIFFERENT category, sorted by rating.
    If `date` is passed, filter out artists who are busy/blocked on that day.
    """
    src = await db.artist_profiles.find_one({"user_id": user_id})
    if not src:
        raise HTTPException(404, "Artist not found")
    q: dict = {
        "user_id": {"$ne": user_id},
        "city": src.get("city"),
        "category": {"$ne": src.get("category")},
        "is_active": {"$ne": False},
        "suspended": {"$ne": True},   # Iter 52.8 — hide suspended
    }
    cands = await db.artist_profiles.find(q).sort([("rating_avg", -1), ("review_count", -1)]).to_list(limit * 3)

    if date_str and cands:
        cand_ids = [c["user_id"] for c in cands]
        busy = set()
        async for a in db.availability.find({
            "user_id": {"$in": cand_ids}, "date": date_str,
            "status": {"$in": ["blocked", "booked"]},
        }):
            busy.add(a["user_id"])
        async for b in db.bookings.find({
            "artist_id": {"$in": cand_ids}, "event_date": date_str,
            "status": {"$in": ["pending_artist", "confirmed", "started"]},
        }):
            busy.add(b["artist_id"])
        cands = [c for c in cands if c["user_id"] not in busy]

    out = []
    for c in cands[:limit]:
        out.append({
            "user_id": c["user_id"],
            "stage_name": c.get("stage_name"),
            "category": c.get("category"),
            "city": c.get("city"),
            "starting_price": c.get("starting_price"),
            "rating_avg": c.get("rating_avg", 0),
            "review_count": c.get("review_count", 0),
            "slug": c.get("slug"),
            "profile_image": c.get("profile_image"),
        })
    return {"suggested": out}


# ─────────────────────────────────────────────────────────────────────────────
# BOOKINGS
# ─────────────────────────────────────────────────────────────────────────────
def calc_booking_pricing(package_price: float, addon_total: float, coupon_discount: float = 0) -> dict:
    """
    BookTalent is ONLY an intermediary marketplace. We do NOT collect the artist's
    performance fee — it is settled directly between Customer and Artist.

    The only amount BookTalent collects from the Customer is:
        Platform Service Fee (5% of the Artist Fee) + 18% GST on that fee.

    Coupon discounts apply to the artist_fee (reducing what the customer owes
    the artist, and proportionally the platform_fee + GST).
    """
    artist_fee = round(max(0, package_price + addon_total - coupon_discount), 2)
    platform_fee = round(artist_fee * (PLATFORM_FEE_PCT / 100), 2)   # only thing BookTalent invoices
    gst = round(platform_fee * (GST_PCT / 100), 2)                   # GST is only on the platform fee
    total = round(platform_fee + gst, 2)                              # amount payable to BookTalent
    # Token / balance no longer apply — BookTalent charges 100% upfront on the
    # platform fee; the artist fee is settled directly.
    return {
        "package_fee": package_price,
        "addons_total": addon_total,
        "coupon_discount": coupon_discount,
        "artist_fee": artist_fee,         # paid by customer directly to artist
        "platform_fee": platform_fee,     # the only line BookTalent collects pre-tax
        "gst": gst,                       # 18% on platform_fee
        "total": total,                   # platform_fee + gst (BookTalent invoice total)
        "token_amount": total,            # legacy field — token-equivalent now equals full BookTalent amount
        "balance_due": 0,
    }


ADDON_PRICES = {
    "dhol": 3500, "anchor": 5000, "photo": 4000, "extra-hour": 8000,
}


@api.post("/bookings")
async def create_booking(body: BookingCreate, user: dict = Depends(get_current_user)):
    if user["role"] not in ("customer", "corporate", "agency"):
        raise HTTPException(403, "Only customers can create bookings")
    # Iter 52.5 — enforce Terms & Conditions declaration from the Review step.
    if not body.tnc_accepted:
        raise HTTPException(400, "Please accept the Terms & Conditions before proceeding")
    pkg = await db.packages.find_one({"id": body.package_id, "artist_id": body.artist_id})
    if not pkg:
        raise HTTPException(404, "Package not found")

    artist = await db.users.find_one({"id": body.artist_id})
    if not artist:
        raise HTTPException(404, "Artist not found")
    # Load artist profile once for outstation detection + suggestions below.
    artist_profile = await db.artist_profiles.find_one({"user_id": body.artist_id}) or {}
    # Warm the city-alias cache on first use — subsequent bookings reuse it.
    if not _CITY_ALIAS_MAP:
        await _refresh_city_aliases()

    # check availability
    av = await db.availability.find_one({"user_id": body.artist_id, "date": body.event_date})
    if av and av.get("status") in ("booked", "blocked"):
        # Smart suggestion: find similar artists
        prof = await db.artist_profiles.find_one({"user_id": body.artist_id}) or {}
        suggestions = []
        for q in [
            {"user_id": {"$ne": body.artist_id}, "category": prof.get("category"), "city": prof.get("city"), "suspended": {"$ne": True}},
            {"user_id": {"$ne": body.artist_id}, "category": prof.get("category"), "suspended": {"$ne": True}},
            {"user_id": {"$ne": body.artist_id}, "city": prof.get("city"), "suspended": {"$ne": True}},
        ]:
            if len(suggestions) >= 3:
                break
            for s in await db.artist_profiles.find(q).sort("rating_avg", -1).limit(3).to_list(3):
                if s["user_id"] not in [x["user_id"] for x in suggestions]:
                    suggestions.append(s)
                    if len(suggestions) >= 3:
                        break
        suggestion_data = [
            {
                "user_id": s["user_id"],
                "stage_name": s["stage_name"],
                "category": s.get("category"),
                "city": s.get("city"),
                "rating_avg": s.get("rating_avg", 0),
                "emoji": s.get("emoji", "🎤"),
            }
            for s in suggestions
        ]
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Selected date is not available",
                "alternatives": suggestion_data,
                "date": body.event_date,
            },
        )

    addon_total = sum(ADDON_PRICES.get(a, 0) for a in body.addons)

    # Sprint 3 — artist-defined add-ons on top of the legacy slug-based ones
    from routes.addons import snapshot_addons
    addon_snapshots, addon_v2_total = await snapshot_addons(
        db, body.artist_id, [s.model_dump() for s in body.addon_selections],
    )
    addon_total += addon_v2_total

    coupon_discount = 0
    coupon_doc = None
    if body.coupon_code:
        try:
            base = float(pkg["price"]) + addon_total
            coupon_doc, coupon_discount = await _validate_coupon(
                body.coupon_code, user_id=user["id"], base_amount=base, event_type=body.event_type,
            )
        except HTTPException as ce:
            # Surface coupon error to the customer instead of silently dropping
            raise ce

    pricing = calc_booking_pricing(float(pkg["price"]), addon_total, coupon_discount)

    # Iter 44 — Resolve or generate the event umbrella. If the customer passed
    # an event_id we validate they already own another booking under it; else
    # we mint a fresh event_id so future artists can be added to this event.
    event_id_final: Optional[str] = None
    if body.event_id:
        owned = await db.bookings.find_one({"event_id": body.event_id, "customer_id": user["id"]})
        if not owned:
            raise HTTPException(400, "event_id does not belong to you")
        event_id_final = body.event_id
    else:
        event_id_final = new_id()

    bid = new_id()
    ref = booking_ref()
    doc = {
        "id": bid,
        "ref": ref,
        "event_id": event_id_final,
        "customer_id": user["id"],
        "artist_id": body.artist_id,
        "package_id": body.package_id,
        "package_name": pkg["name"],
        "addons": body.addons,
        "addon_snapshots": addon_snapshots,
        # Sprint 4 — snapshot the travel/accommodation requirements from the package
        # at booking creation time so future edits to the package don't change history
        "travel_requirements": {
            "travel_required": bool(pkg.get("travel_required")),
            "accommodation_required": bool(pkg.get("accommodation_required")),
            "hotel_category": pkg.get("hotel_category"),
            "flight_class": pkg.get("flight_class"),
            "team_size": pkg.get("team_size"),
            "arrival_buffer_days": pkg.get("arrival_buffer_days"),
            "local_transport_required": bool(pkg.get("local_transport_required")),
            "meals_required": bool(pkg.get("meals_required")),
            "travel_notes": pkg.get("travel_notes", ""),
        },
        "event_date": body.event_date,
        "event_time": body.event_time,
        "event_type": body.event_type,
        "venue": body.venue,
        "city": body.city,
        # Iter 52.5 — Customer-offered travel allowance (direct-to-artist,
        # informational only). Printed on the contract PDF.
        "customer_travel_allowance": float(body.customer_travel_allowance or 0),
        # Iter 52.5 — T&C declaration audit trail (also enforced at request-time
        # via the 400 guard above).
        "tnc_accepted": True,
        "tnc_accepted_at": datetime.now(timezone.utc).isoformat(),
        # Outstation Business Rule — snapshot both cities and flag mismatch at
        # booking-creation time so history is immutable even if the artist
        # profile city or the customer's event city is edited later.
        # City aliases (Delhi/NCR/New Delhi etc.) are canonicalised first so
        # intra-region events don't wrongly trigger the outstation gate.
        "artist_city": artist_profile.get("city") if artist_profile else None,
        "event_city": body.city,
        "is_outstation": _outstation_check(
            artist_profile.get("city") if artist_profile else None,
            body.city,
            _CITY_ALIAS_MAP,
        ),
        "guests": body.guests,
        "language_pref": body.language_pref,
        "notes": body.notes,
        "special_instructions": (body.special_instructions or "").strip(),
        "customer_name": body.customer_name or f"{user.get('first_name','')} {user.get('last_name','')}".strip(),
        "customer_phone": body.customer_phone or user.get("phone"),
        "customer_email": body.customer_email or user.get("email"),
        "coupon_code": body.coupon_code,
        "pricing": pricing,
        "status": "pending_payment",  # pending_payment → pending_artist → confirmed → started → completed → reviewed
        "payment_status": "unpaid",
        "amount_paid": 0,
        "history": [{"at": utcnow(), "action": "created", "by": user["id"]}],
        "created_at": utcnow(),
    }
    await db.bookings.insert_one(doc)

    # Coupon redemption ledger + counters
    if coupon_doc and coupon_discount > 0:
        await db.coupon_redemptions.insert_one({
            "id": new_id(),
            "coupon_id": coupon_doc["id"],
            "coupon_code": coupon_doc["code"],
            "user_id": user["id"],
            "booking_id": bid,
            "discount_amount": coupon_discount,
            "booking_total": pricing["total"],
            "created_at": utcnow(),
        })
        await db.coupons.update_one(
            {"id": coupon_doc["id"]},
            {"$inc": {"usage_count": 1, "total_discount": coupon_discount}},
        )

    # notifications: artist
    await db.notifications.insert_one({
        "id": new_id(), "user_id": body.artist_id, "type": "booking_request",
        "title": "New booking inquiry", "body": f"New inquiry for {body.event_date}", "read": False, "created_at": utcnow(),
        "link": f"/dashboard/bookings/{bid}",
    })

    return clean(doc)


# ─────────────────────────────────────────────────────────────────────────────
# Iter 44 — Multi-Artist Cart Batch Booking
# ─────────────────────────────────────────────────────────────────────────────
class BookingBatchCreate(BaseModel):
    items: List[BookingCreate]
    event_id: Optional[str] = None  # shared event umbrella (auto-generated if omitted)


@api.post("/bookings/batch")
async def create_booking_batch(body: BookingBatchCreate, user: dict = Depends(get_current_user)):
    """Create N bookings in one shot, all sharing a single event_id so the
    customer can see them together on the Booking Recap page and pay for all
    Platform Service Fees in a single Razorpay checkout. Each booking still
    has its own 24-hour Artist Confirmation window, its own contract, and its
    own pending_artist → confirmed lifecycle."""
    if user["role"] not in ("customer", "corporate", "agency"):
        raise HTTPException(403, "Only customers can create bookings")
    if not body.items:
        raise HTTPException(400, "At least one booking item is required")
    if len(body.items) > 6:
        raise HTTPException(400, "Cannot batch more than 6 artists per event")

    # Resolve umbrella event_id (validate ownership if provided).
    event_id_final: Optional[str]
    if body.event_id:
        owned = await db.bookings.find_one({"event_id": body.event_id, "customer_id": user["id"]})
        if not owned:
            raise HTTPException(400, "event_id does not belong to you")
        event_id_final = body.event_id
    else:
        event_id_final = None  # first item will mint it, then we stamp the rest

    created_ids: List[str] = []
    created_refs: List[str] = []
    total_platform_fee = 0.0
    total_gst = 0.0
    total_token = 0.0
    # Each item shares the umbrella event_id — we simply forward-call the
    # single-booking creator to reuse ALL the availability, coupon,
    # outstation, snapshot and notification logic. The FIRST item mints
    # the event_id when caller didn't provide one; every subsequent item
    # attaches to it. Any 400 short-circuits the entire batch (best-effort
    # — no cross-doc transaction).
    for idx, item in enumerate(body.items):
        # Only pass event_id once we have one that already belongs to the
        # customer — otherwise create_booking's ownership gate rejects it.
        item.event_id = event_id_final if event_id_final else None
        doc = await create_booking(item, user)  # returns cleaned booking dict
        if event_id_final is None:
            event_id_final = doc.get("event_id")
        created_ids.append(doc["id"])
        created_refs.append(doc["ref"])
        p = doc.get("pricing", {})
        total_platform_fee += float(p.get("platform_fee", 0) or 0)
        total_gst += float(p.get("gst", 0) or 0)
        total_token += float(p.get("token_amount", p.get("total", 0)) or 0)

    return {
        "event_id": event_id_final,
        "booking_ids": created_ids,
        "booking_refs": created_refs,
        "pricing_total": {
            "platform_fee": round(total_platform_fee, 2),
            "gst": round(total_gst, 2),
            "token_amount": round(total_token, 2),
        },
    }


class BatchPaymentInit(BaseModel):
    booking_ids: List[str]
    method: Literal["card", "upi", "netbanking"]


@api.post("/payments/batch/init")
async def payment_batch_init(body: BatchPaymentInit, user: dict = Depends(get_current_user)):
    """Initialise a single Razorpay order for many bookings so the customer
    checks out once and BookTalent collects the combined Platform Service Fee
    + GST for every artist in the event."""
    if not body.booking_ids:
        raise HTTPException(400, "booking_ids required")
    docs = await db.bookings.find({"id": {"$in": body.booking_ids}}).to_list(20)
    if len(docs) != len(body.booking_ids):
        raise HTTPException(404, "Some bookings not found")
    for d in docs:
        if d["customer_id"] != user["id"]:
            raise HTTPException(403, "Not your booking")
    total_amount = round(sum(float((d.get("pricing") or {}).get("token_amount", 0) or 0) for d in docs), 2)
    pid = new_id()

    pay_doc = {
        "id": pid,
        "booking_ids": body.booking_ids,
        "user_id": user["id"],
        "amount": total_amount,
        "method": body.method,
        "status": "pending",
        "created_at": utcnow(),
        "batch": True,
    }

    if RAZORPAY_ENABLED:
        amount_paise = int(round(total_amount * 100))
        receipt = f"BT-BATCH-{pid[:10]}"
        try:
            order = razorpay_client.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "receipt": receipt,
                "payment_capture": 1,
                "notes": {
                    "customer_id": user["id"],
                    "batch": "true",
                    "count": str(len(docs)),
                    "event_id": docs[0].get("event_id", ""),
                },
            })
        except Exception as e:
            log.error(f"Razorpay batch order error: {e}")
            raise HTTPException(502, f"Payment gateway error: {e}")
        pay_doc.update({
            "gateway": "razorpay",
            "razorpay_order_id": order["id"],
            "amount_paise": amount_paise,
        })
        await db.payments.insert_one(pay_doc)
        return {
            "payment_id": pid,
            "amount": total_amount,
            "amount_paise": amount_paise,
            "gateway": "razorpay",
            "count": len(docs),
            "razorpay": {
                "order_id": order["id"],
                "key_id": RAZORPAY_KEY_ID,
                "currency": "INR",
                "name": "BookTalent",
                "description": f"Multi-Artist Event · {len(docs)} bookings",
                "notes": {"batch": "true", "count": str(len(docs))},
            },
        }

    pay_doc["gateway"] = "razorpay_mock"
    await db.payments.insert_one(pay_doc)
    return {"payment_id": pid, "amount": total_amount, "count": len(docs), "gateway": "razorpay_mock"}


class BatchPaymentVerify(BaseModel):
    payment_id: str
    booking_ids: List[str]
    mock_otp: Optional[str] = "123456"
    razorpay_order_id: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_signature: Optional[str] = None


@api.post("/payments/batch/verify")
async def payment_batch_verify(body: BatchPaymentVerify, user: dict = Depends(get_current_user)):
    pay = await db.payments.find_one({"id": body.payment_id})
    if not pay or pay["user_id"] != user["id"]:
        raise HTTPException(404, "Payment not found")
    docs = await db.bookings.find({"id": {"$in": body.booking_ids}}).to_list(20)
    if len(docs) != len(body.booking_ids):
        raise HTTPException(404, "Some bookings not found")
    for d in docs:
        if d["customer_id"] != user["id"]:
            raise HTTPException(403, "Not your booking")

    is_live = pay.get("gateway") == "razorpay"
    if is_live:
        if not (body.razorpay_order_id and body.razorpay_payment_id and body.razorpay_signature):
            raise HTTPException(400, "Missing Razorpay verification params")
        try:
            razorpay_client.utility.verify_payment_signature({
                "razorpay_order_id": body.razorpay_order_id,
                "razorpay_payment_id": body.razorpay_payment_id,
                "razorpay_signature": body.razorpay_signature,
            })
        except razorpay.errors.SignatureVerificationError:
            await db.payments.update_one({"id": body.payment_id}, {"$set": {"status": "failed", "failure_reason": "signature_mismatch"}})
            raise HTTPException(400, "Signature verification failed")
        await db.payments.update_one(
            {"id": body.payment_id},
            {"$set": {"status": "completed", "razorpay_payment_id": body.razorpay_payment_id,
                      "razorpay_signature": body.razorpay_signature, "verified_at": utcnow()}},
        )
    else:
        if body.mock_otp != "123456":
            raise HTTPException(400, "Invalid OTP (use 123456 in test mode)")
        await db.payments.update_one(
            {"id": body.payment_id}, {"$set": {"status": "completed", "verified_at": utcnow()}},
        )

    from datetime import timedelta as _td
    _confirm_hours = int(os.environ.get("BOOKING_CONFIRM_WINDOW_HOURS", "24"))
    expires_at_iso = (datetime.now(timezone.utc) + _td(hours=_confirm_hours)).isoformat()

    for d in docs:
        # Skip bookings that are no longer awaiting payment — never
        # regress a `confirmed`/`cancelled` booking back to `pending_artist`.
        if d.get("status") != "pending_payment":
            continue
        share = float((d.get("pricing") or {}).get("token_amount", 0) or 0)
        await db.bookings.update_one(
            {"id": d["id"]},
            {"$set": {"payment_status": "token_paid", "amount_paid": share,
                      "status": "pending_artist",
                      "expires_at": expires_at_iso,
                      "confirmation_deadline_hours": _confirm_hours},
             "$push": {"history": {"at": utcnow(), "action": "paid_token_batch", "by": user["id"],
                                   "amount": share, "payment_id": body.payment_id,
                                   "gateway": pay.get("gateway")}}},
        )
        await db.transactions.insert_one({
            "id": new_id(), "user_id": user["id"], "type": "payment",
            "amount": -share, "status": "completed",
            "description": f"Token paid for booking {d['ref']} (batch)",
            "booking_id": d["id"], "gateway": pay.get("gateway"),
            "created_at": utcnow(),
        })
        await db.notifications.insert_one({
            "id": new_id(), "user_id": d["artist_id"], "type": "booking_request",
            "title": "New paid booking request",
            "body": f"Token received for booking {d['ref']}",
            "read": False, "created_at": utcnow(),
            "link": f"/dashboard/bookings/{d['id']}",
        })
    return {
        "ok": True,
        "count": len(docs),
        "booking_refs": [d["ref"] for d in docs],
        "event_id": docs[0].get("event_id"),
    }


# Iter 48 — /events/{id}/recap + /events/{id}/summary moved to routes/events.py
# (registered near the bottom of this file alongside the other route modules).


# Iter 53 — Artist Payment Gating: platform fee, GST and BookTalent-side totals
# are BookTalent-only lines. Artists must never see them (transparent
# business-model rule). They only see: package_name, pricing.package_fee.
# We keep pricing.addons_total + artist_fee (their earnings) too, but scrub
# platform_fee / gst / total / token_amount / balance_due before serialising.
_ARTIST_PRICING_REDACT_KEYS = (
    "platform_fee",
    "gst",
    "total",
    "token_amount",
    "balance_due",
    "coupon_discount",
)


def _redact_pricing_for_artist(booking_doc: dict) -> None:
    """Remove BookTalent-facing pricing lines from a booking dict in-place."""
    p = booking_doc.get("pricing")
    if isinstance(p, dict):
        for k in _ARTIST_PRICING_REDACT_KEYS:
            p.pop(k, None)


@api.get("/bookings/mine")
async def my_bookings(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {}
    if user["role"] == "artist":
        q["artist_id"] = user["id"]
    elif user["role"] == "admin":
        pass
    else:
        q["customer_id"] = user["id"]
    if status:
        q["status"] = status
    docs = await db.bookings.find(q).sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        cleaned = clean(d)
        paid = (cleaned.get("payment_status") == "paid") or (cleaned.get("amount_paid", 0) > 0)
        # Iter 52.8 — Same contact-privacy rule as GET /bookings/{bid}.
        if not paid and user["role"] == "artist":
            for k in ("customer_phone", "customer_email"):
                cleaned.pop(k, None)
            cleaned["_contact_locked"] = True
        # Iter 53 — Business-model transparency: strip platform-fee / total
        # from every artist-facing booking payload regardless of payment state.
        if user["role"] == "artist":
            _redact_pricing_for_artist(cleaned)
        out.append(cleaned)
    return out


@api.get("/bookings/{bid}")
async def get_booking(bid: str, user: dict = Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")
    if user["role"] != "admin" and user["id"] not in (doc["customer_id"], doc["artist_id"]):
        raise HTTPException(403, "Forbidden")
    artist = await db.users.find_one({"id": doc["artist_id"]})
    artist_p = await db.artist_profiles.find_one({"user_id": doc["artist_id"]})
    customer = await db.users.find_one({"id": doc["customer_id"]})

    # Iter 52.8 — Contact-details privacy gate.
    # Business rule: mobile number + email are exchanged ONLY after the
    # customer has settled the Platform Service Fee. Admins always see
    # everything. The redact-until-paid rule prevents artists from being
    # side-solicited before BookTalent has captured its fee, and protects
    # customer PII from artists who might reject the booking anyway.
    paid = (doc.get("payment_status") == "paid") or (doc.get("amount_paid", 0) > 0)
    redact_customer_contact = not paid and user["role"] == "artist"
    redact_artist_contact  = not paid and user["role"] in ("customer", "corporate", "agency")

    customer_clean = clean(customer) if customer else None
    artist_clean = clean(artist) if artist else None
    if customer_clean and redact_customer_contact:
        for k in ("phone", "email", "whatsapp", "alt_phone"):
            customer_clean.pop(k, None)
        customer_clean["_contact_locked"] = True
    if artist_clean and redact_artist_contact:
        for k in ("phone", "email", "whatsapp", "alt_phone"):
            artist_clean.pop(k, None)
        artist_clean["_contact_locked"] = True

    # Iter 53 — For artist viewers, strip platform-fee / GST / grand-total from
    # the pricing block AND the top-level booking fields the customer sees.
    booking_clean = clean(doc)
    if user["role"] == "artist":
        _redact_pricing_for_artist(booking_clean)
        # customer_phone / customer_email also live on the flat booking doc.
        if not paid:
            for k in ("customer_phone", "customer_email"):
                booking_clean.pop(k, None)
            booking_clean["_contact_locked"] = True

    return {
        "booking": booking_clean,
        "artist": artist_clean,
        "artist_profile": clean(artist_p) if artist_p else None,
        "customer": customer_clean,
        "contact_unlocked": paid,
    }


@api.post("/bookings/{bid}/action")
async def booking_action(bid: str, body: BookingStatusUpdate, user: dict = Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")

    is_customer = user["id"] == doc["customer_id"]
    is_artist = user["id"] == doc["artist_id"]
    is_admin = user["role"] == "admin"

    new_status = doc["status"]
    history_entry = {"at": utcnow(), "action": body.action, "by": user["id"], "reason": body.reason}

    if body.action == "accept" and (is_artist or is_admin) and doc["status"] in ("pending_artist", "pending_payment"):
        new_status = "confirmed"
        await _create_contract(doc)
        # Auto-block the event date so no double-booking
        await db.availability.update_one(
            {"user_id": doc["artist_id"], "date": doc["event_date"]},
            {"$set": {"id": new_id(), "user_id": doc["artist_id"], "date": doc["event_date"], "status": "booked", "booking_id": doc["id"]}},
            upsert=True,
        )
        # Booking confirmation email to customer
        try:
            artist_p = await db.artist_profiles.find_one({"user_id": doc["artist_id"]}) or {}
            artist_u = await db.users.find_one({"id": doc["artist_id"]}) or {}
            artist_name = artist_p.get("stage_name") or f"{artist_u.get('first_name', '')} {artist_u.get('last_name', '')}".strip()
            await send_booking_confirmation_email(
                doc.get("customer_email") or "",
                doc.get("customer_name") or "",
                doc.get("ref", ""),
                artist_name,
                doc.get("event_date", ""),
            )
            # Smart notification: confirm both parties + admin via dispatcher
            await notify_dispatch(db, user_id=doc["customer_id"], event="booking.confirmed",
                channels=["in_app", "email"],
                ctx={"title": "Booking confirmed", "body": f"Your booking {doc['ref']} with {artist_name} for {doc['event_date']} is confirmed.",
                     "artist_name": artist_name, "event_date": doc.get("event_date", ""), "ref": doc.get("ref", "")},
                email=doc.get("customer_email"))
            await notify_dispatch(db, user_id=doc["artist_id"], event="booking.confirmed",
                channels=["in_app", "email"],
                ctx={"title": "You accepted a booking", "body": f"Booking {doc['ref']} is now confirmed. Event: {doc['event_date']}",
                     "ref": doc.get("ref", ""), "event_date": doc.get("event_date", "")},
                email=artist_u.get("email"))
            # Notify all admins
            async for adm in db.users.find({"role": "admin"}, {"id": 1, "email": 1}):
                await notify_dispatch(db, user_id=adm["id"], event="booking.confirmed.admin",
                    channels=["in_app"],
                    ctx={"title": "New booking confirmed", "body": f"Booking {doc['ref']} confirmed: {artist_name} → {doc.get('customer_name', '')}"})
        except Exception as _e:
            log.warning("Confirmation email failed: %s", _e)
    elif body.action == "reject" and (is_artist or is_admin) and doc["status"] in ("pending_artist", "pending_payment"):
        new_status = "rejected"
        # If a Platform Service Fee was already collected, mark the payment for
        # refund. Actual money-back happens via the Razorpay refund endpoint,
        # not through any internal wallet.
        if doc.get("amount_paid", 0) > 0:
            await _mark_platform_fee_refundable(doc, f"Refund for rejected booking {doc['ref']}")
    elif body.action == "start" and is_artist and doc["status"] == "confirmed":
        new_status = "started"
    elif body.action == "complete" and is_artist and doc["status"] in ("confirmed", "started"):
        new_status = "completed_by_artist"
    elif body.action == "approve_completion" and (is_customer or is_admin) and doc["status"] in ("completed_by_artist", "completed"):
        new_status = "completed"
        # BookTalent is a lead-generation marketplace only — no artist wallet
        # settlement. We simply mark the booking complete and bump artist
        # stats. Artist Performance Fee is settled directly Customer ↔ Artist.
        await _record_completion(doc)
    elif body.action == "cancel" and (is_customer or is_admin) and doc["status"] in ("pending_artist", "pending_payment", "confirmed"):
        new_status = "cancelled"
        if doc.get("amount_paid", 0) > 0:
            await _mark_platform_fee_refundable(doc, f"Refund for cancelled booking {doc['ref']}")
    else:
        raise HTTPException(400, "Action not allowed in current state")

    await db.bookings.update_one(
        {"id": bid},
        {"$set": {"status": new_status, "updated_at": utcnow()}, "$push": {"history": history_entry}},
    )

    # notifications
    notify_user = doc["customer_id"] if is_artist else doc["artist_id"]
    await db.notifications.insert_one({
        "id": new_id(), "user_id": notify_user, "type": "booking_update",
        "title": f"Booking {body.action}", "body": f"Booking {doc['ref']} → {new_status}",
        "read": False, "created_at": utcnow(), "link": f"/dashboard/bookings/{bid}",
    })

    return {"ok": True, "status": new_status}


def _format_travel_reqs(reqs: dict) -> str:
    """Sprint 4 — render travel/accommodation snapshot for the contract PDF."""
    if not reqs or not (
        reqs.get("travel_required") or reqs.get("accommodation_required")
        or reqs.get("meals_required") or reqs.get("local_transport_required")
        or reqs.get("travel_notes")
    ):
        return "  None specified.\n"
    lines = []
    if reqs.get("travel_required"):
        cls = reqs.get("flight_class") or "economy"
        lines.append(f"  Flight/Travel     : Yes ({cls}) for {reqs.get('team_size') or 1} person(s)")
    if reqs.get("accommodation_required"):
        cat = reqs.get("hotel_category") or "3-star"
        lines.append(f"  Accommodation     : Yes — {cat} hotel for {reqs.get('team_size') or 1} person(s)")
    if reqs.get("arrival_buffer_days"):
        lines.append(f"  Arrival buffer    : {reqs['arrival_buffer_days']} day(s) prior to event")
    if reqs.get("local_transport_required"):
        lines.append("  Local transport   : Required (airport pickup + venue transfers)")
    if reqs.get("meals_required"):
        lines.append("  Meals             : Required (all meals during stay)")
    if reqs.get("travel_notes"):
        lines.append(f"  Additional notes  : {reqs['travel_notes']}")
    return "\n".join(lines) + "\n"


async def _create_contract(booking: dict) -> str:
    cid = new_id()
    artist = await db.users.find_one({"id": booking["artist_id"]})
    artist_p = await db.artist_profiles.find_one({"user_id": booking["artist_id"]})

    # Pull admin-editable outstation clause + fee note from system_settings so
    # legal/policy tweaks don't require a redeploy.
    clause_doc = await db.system_settings.find_one({"key": "outstation_clause"})
    fee_note_doc = await db.system_settings.find_one({"key": "booking_fee_note"})
    outstation_clause = (clause_doc or {}).get("value") or (
        "For outstation bookings, all travel, accommodation, food, local "
        "transportation, hospitality and any additional logistics required for "
        "the Artist or accompanying team shall be arranged and paid separately "
        "by the Customer. These expenses are not included in the Artist "
        "Performance Fee or the Platform Service Fee."
    )
    fee_note = (fee_note_doc or {}).get("value") or (
        "Travel, accommodation, local transport, food, hospitality and any "
        "other outstation expenses are NOT included in the Artist Package Fee."
    )
    outstation_block = ""
    if booking.get("is_outstation"):
        outstation_block = (
            f"OUTSTATION LOGISTICS ({booking.get('artist_city') or '—'} → "
            f"{booking.get('event_city') or booking.get('city') or '—'}):\n"
            f"  {outstation_clause}\n\n"
        )

    body_text = f"""
BOOKTALENT ARTIST PERFORMANCE AGREEMENT

Booking Reference: {booking['ref']}
Date of Agreement: {datetime.now().strftime('%B %d, %Y')}

ARTIST: {artist_p.get('stage_name') if artist_p else (artist.get('first_name') + ' ' + artist.get('last_name', ''))}
CLIENT: {booking.get('customer_name')}

EVENT DETAILS:
  Event Type : {booking.get('event_type')}
  Date       : {booking.get('event_date')} at {booking.get('event_time')}
  Venue      : {booking.get('venue')}, {booking.get('city')}
  Package    : {booking.get('package_name')}

TRAVEL & ACCOMMODATION (borne by Client, in addition to the Artist Fee):
{_format_travel_reqs(booking.get('travel_requirements') or {})}{
    ("  Customer Travel Allowance offered (direct-to-artist) : ₹" + f"{float(booking.get('customer_travel_allowance') or 0):.2f}" + chr(10))
    if float(booking.get('customer_travel_allowance') or 0) > 0 else ""
}{outstation_block}{"SPECIAL INSTRUCTIONS FROM CLIENT:" + chr(10) + "  " + (booking.get("special_instructions") or "").strip() + chr(10) + chr(10) if (booking.get("special_instructions") or "").strip() else ""}FINANCIAL TERMS:
  Artist Performance Fee (paid by Client directly to Artist) : ₹{booking['pricing'].get('artist_fee', booking['pricing'].get('package_fee', 0) + booking['pricing'].get('addons_total', 0)):.2f}

  Platform Service Fee (5% — payable to BookTalent)          : ₹{booking['pricing']['platform_fee']:.2f}
  GST (18% on Platform Fee)                                  : ₹{booking['pricing']['gst']:.2f}
  AMOUNT PAYABLE TO BOOKTALENT                                : ₹{booking['pricing']['total']:.2f}

FEE INCLUSION NOTE:
  {fee_note}

STANDARD TERMS:
  1. BookTalent acts only as a technology platform facilitating the connection
     between the Customer and the Artist. The Artist Performance Fee shall be
     paid directly by the Customer to the Artist as mutually agreed.
     BookTalent shall NOT be responsible for the settlement of the
     Artist Performance Fee.
  2. The Artist agrees to perform as described above on the agreed date.
  3. The Client agrees to provide stage, sound, hospitality as per package rider.
  4. Cancellation by Client 15+ days prior: full refund of the Platform Service Fee.
  5. Cancellation by Client within 7 days: Platform Service Fee is non-refundable.
  6. Cancellation by Artist: 100% refund of Platform Service Fee + priority rebooking.
  7. Refund of any Artist Performance Fee already paid directly is governed by
     the mutual agreement between Customer and Artist.
  8. This contract is auto-generated and governed by BookTalent's Standard Agreement.

Digital signatures recorded electronically upon booking confirmation.
"""
    await db.contracts.insert_one({
        "id": cid,
        "booking_id": booking["id"],
        "artist_id": booking["artist_id"],
        "customer_id": booking["customer_id"],
        "ref": "CT-" + booking["ref"].split("-", 1)[1],
        "body": body_text,
        "status": "signed",  # auto-signed on accept
        "signed_at": utcnow(),
        "created_at": utcnow(),
    })
    await db.bookings.update_one({"id": booking["id"]}, {"$set": {"contract_id": cid}})
    return cid


async def _mark_platform_fee_refundable(booking: dict, note: str):
    """
    BookTalent's lead-generation model: the only money we ever collected is
    the Platform Service Fee + GST (Razorpay charge on the customer). When a
    booking is cancelled/rejected after payment, we flag the payment record so
    an admin can trigger the actual Razorpay refund from the Payments UI.
    No internal wallets are involved.
    """
    await db.payments.update_many(
        {"booking_id": booking["id"], "status": "completed"},
        {"$set": {"refund_pending": True, "refund_note": note, "refund_flagged_at": utcnow()}},
    )
    # Audit trail on the customer ledger (informational only).
    await db.transactions.insert_one({
        "id": new_id(), "user_id": booking["customer_id"], "type": "refund_flagged",
        "amount": float(booking.get("amount_paid", 0)), "status": "pending_admin_refund",
        "description": note, "booking_id": booking["id"], "created_at": utcnow(),
    })


# ─── 24-Hour Artist Confirmation window — auto-expiry worker ─────────────
async def _auto_expire_bookings_once():
    """
    Runs on a schedule. Any booking that has been in `pending_artist` for
    longer than `confirmation_deadline_hours` (default 24) is auto-cancelled
    and the Platform Service Fee flagged for refund. Notifies customer + artist.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    stale = db.bookings.find({
        "status": {"$in": ["pending_artist", "pending_payment"]},
        "expires_at": {"$lte": now_iso},
    })
    async for doc in stale:
        try:
            await db.bookings.update_one(
                {"id": doc["id"], "status": {"$in": ["pending_artist", "pending_payment"]}},
                {"$set": {"status": "auto_expired", "expired_at": utcnow()},
                 "$push": {"history": {"at": utcnow(), "action": "auto_expired", "by": "system",
                                        "reason": "Artist did not confirm within 24 hours"}}},
            )
            if doc.get("amount_paid", 0) > 0:
                await _mark_platform_fee_refundable(doc, f"Auto-expiry refund for {doc.get('ref', doc['id'])}")
            # Customer + artist notifications (in-app + email via dispatcher)
            try:
                artist_u = await db.users.find_one({"id": doc.get("artist_id")}) or {}
                await notify_dispatch(db, user_id=doc["customer_id"], event="booking.auto_expired",
                    channels=["in_app", "email"],
                    ctx={"title": "Booking request expired",
                         "body": f"Your booking request {doc.get('ref', '')} expired because the artist did not confirm within 24 hours. Your Platform Service Fee will be refunded within 5-7 business days.",
                         "ref": doc.get("ref", "")},
                    email=doc.get("customer_email"))
                await notify_dispatch(db, user_id=doc["artist_id"], event="booking.auto_expired",
                    channels=["in_app", "email"],
                    ctx={"title": "Booking request expired",
                         "body": f"Booking {doc.get('ref', '')} expired because you did not respond within 24 hours."},
                    email=artist_u.get("email"))
            except Exception as _e:
                log.warning("Auto-expire notify failed: %s", _e)
        except Exception as e:
            log.error("Auto-expire booking %s failed: %s", doc.get("id"), e)


async def _auto_expire_loop():
    """Background loop that ticks the auto-expiry check every N minutes."""
    interval_min = int(os.environ.get("BOOKING_EXPIRY_CHECK_MINUTES", "15"))
    log.info("Auto-expiry loop starting (every %d min)", interval_min)
    while True:
        try:
            await _auto_expire_bookings_once()
        except Exception as e:
            log.error("Auto-expiry tick failed: %s", e)
        # Iter 52.9 — Piggy-back subscription-expiry sweep on the same loop
        # so we don't spin up another cron. Flips active → expired past ETA,
        # downgrades premium_badge, and fires 7-day/1-day warning notices.
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            soon_iso = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            async for s in db.artist_subscriptions.find({"status": "active", "expires_at": {"$lt": now_iso}}):
                await db.artist_subscriptions.update_one(
                    {"_id": s["_id"]},
                    {"$set": {"status": "expired", "expired_at": now_iso}},
                )
                await db.artist_profiles.update_one(
                    {"user_id": s["artist_id"]},
                    {"$set": {"premium_badge": False, "plan_code": "free", "plan_rank": 0}},
                )
                await db.notifications.insert_one({
                    "id": new_id(), "user_id": s["artist_id"], "type": "subscription",
                    "title": "Subscription expired",
                    "body": "Your subscription has expired. Renew to keep premium benefits.",
                    "read": False, "created_at": now_iso,
                })
            async for s in db.artist_subscriptions.find({"status": "active", "expires_at": {"$lte": soon_iso, "$gte": now_iso}}):
                try:
                    dt_exp = datetime.fromisoformat(s["expires_at"].replace("Z", "+00:00"))
                except Exception:
                    continue
                days = int((dt_exp - datetime.now(timezone.utc)).total_seconds() // 86400)
                marker = f"expiry_warn_{days}d_sent"
                if days in (7, 1) and not s.get(marker):
                    await db.artist_subscriptions.update_one({"_id": s["_id"]}, {"$set": {marker: True}})
                    await db.notifications.insert_one({
                        "id": new_id(), "user_id": s["artist_id"], "type": "subscription",
                        "title": f"Subscription expires in {days} day{'s' if days != 1 else ''}",
                        "body": "Renew now to avoid losing premium benefits.",
                        "read": False, "created_at": now_iso,
                    })
        except Exception as e:
            log.error("Subscription expiry sweep failed: %s", e)
        await asyncio.sleep(interval_min * 60)


async def _record_completion(booking: dict):
    """
    Marketplace model: BookTalent does NOT collect the Artist Performance Fee.
    That is settled directly Customer ↔ Artist. This helper just bumps artist
    stats and writes an informational ledger row.
    """
    artist_fee = float(booking["pricing"].get(
        "artist_fee",
        booking["pricing"].get("package_fee", 0)
        + booking["pricing"].get("addons_total", 0)
        - booking["pricing"].get("coupon_discount", 0),
    ))
    await db.transactions.insert_one({
        "id": new_id(), "user_id": booking["artist_id"], "type": "direct_settlement",
        "amount": artist_fee, "status": "informational",
        "description": f"Direct settlement from customer for booking {booking['ref']} (not processed by BookTalent)",
        "booking_id": booking["id"], "created_at": utcnow(),
    })
    await db.artist_profiles.update_one(
        {"user_id": booking["artist_id"]},
        {"$inc": {"events_done": 1}},
    )


# ─────────────────────────────────────────────────────────────────────────────
# PAYMENTS — Razorpay live (with safe mock fallback when keys absent)
# ─────────────────────────────────────────────────────────────────────────────
@api.get("/payments/config")
async def payment_config():
    """Public config so frontend knows whether to use real Razorpay or mock."""
    return {
        "razorpay_enabled": RAZORPAY_ENABLED,
        "razorpay_key_id": RAZORPAY_KEY_ID if RAZORPAY_ENABLED else None,
        "currency": "INR",
    }


@api.post("/payments/init")
async def payment_init(body: PaymentInitBody, user: dict = Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": body.booking_id})
    if not doc or doc["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")
    amount = float(doc["pricing"]["token_amount"])
    pid = new_id()

    pay_doc = {
        "id": pid, "booking_id": body.booking_id, "user_id": user["id"],
        "amount": amount, "method": body.method, "status": "pending",
        "created_at": utcnow(),
    }

    if RAZORPAY_ENABLED:
        # Razorpay amounts are in paise (INR * 100)
        amount_paise = int(round(amount * 100))
        # receipt ≤ 40 chars
        receipt = f"BT-{doc['ref'][-12:]}-{pid[:6]}"
        try:
            order = razorpay_client.order.create({
                "amount": amount_paise,
                "currency": "INR",
                "receipt": receipt,
                "payment_capture": 1,
                "notes": {
                    "booking_id": body.booking_id,
                    "booking_ref": doc["ref"],
                    "customer_id": user["id"],
                    "artist_id": doc["artist_id"],
                },
            })
        except Exception as e:
            log.error(f"Razorpay order error: {e}")
            raise HTTPException(502, f"Payment gateway error: {e}")

        pay_doc.update({
            "gateway": "razorpay",
            "razorpay_order_id": order["id"],
            "amount_paise": amount_paise,
        })
        await db.payments.insert_one(pay_doc)
        return {
            "payment_id": pid,
            "amount": amount,
            "amount_paise": amount_paise,
            "gateway": "razorpay",
            "razorpay": {
                "order_id": order["id"],
                "key_id": RAZORPAY_KEY_ID,
                "currency": "INR",
                "name": "BookTalent",
                "description": f"Booking {doc['ref']}",
                "prefill": {
                    "name": doc.get("customer_name") or "",
                    "email": doc.get("customer_email") or "",
                    "contact": doc.get("customer_phone") or "",
                },
                "notes": {"booking_id": body.booking_id, "booking_ref": doc["ref"]},
            },
        }

    # Mock fallback
    pay_doc["gateway"] = "razorpay_mock"
    await db.payments.insert_one(pay_doc)
    return {
        "payment_id": pid,
        "amount": amount,
        "gateway": "razorpay_mock",
    }


@api.post("/payments/verify")
async def payment_verify(body: PaymentVerifyBody, user: dict = Depends(get_current_user)):
    pay = await db.payments.find_one({"id": body.payment_id})
    if not pay:
        raise HTTPException(404, "Payment not found")
    booking = await db.bookings.find_one({"id": body.booking_id})
    if not booking:
        raise HTTPException(404, "Booking not found")

    is_live = pay.get("gateway") == "razorpay"
    if is_live:
        if not (body.razorpay_order_id and body.razorpay_payment_id and body.razorpay_signature):
            raise HTTPException(400, "Missing Razorpay verification params")
        # Verify signature: HMAC SHA256 of order_id|payment_id with key_secret
        try:
            razorpay_client.utility.verify_payment_signature({
                "razorpay_order_id": body.razorpay_order_id,
                "razorpay_payment_id": body.razorpay_payment_id,
                "razorpay_signature": body.razorpay_signature,
            })
        except razorpay.errors.SignatureVerificationError:
            await db.payments.update_one({"id": body.payment_id}, {"$set": {"status": "failed", "failure_reason": "signature_mismatch"}})
            raise HTTPException(400, "Signature verification failed")
        await db.payments.update_one(
            {"id": body.payment_id},
            {"$set": {
                "status": "completed",
                "razorpay_payment_id": body.razorpay_payment_id,
                "razorpay_signature": body.razorpay_signature,
                "verified_at": utcnow(),
            }},
        )
    else:
        # mock mode: accept OTP 123456
        if body.mock_otp != "123456":
            raise HTTPException(400, "Invalid OTP (use 123456 in test mode)")
        await db.payments.update_one(
            {"id": body.payment_id},
            {"$set": {"status": "completed", "verified_at": utcnow()}},
        )

    # Update booking + start the 24-hour Artist Confirmation window
    from datetime import timedelta as _td
    _confirm_hours = int(os.environ.get("BOOKING_CONFIRM_WINDOW_HOURS", "24"))
    expires_at = (datetime.now(timezone.utc) + _td(hours=_confirm_hours)).isoformat()
    new_amount_paid = booking.get("amount_paid", 0) + pay["amount"]
    await db.bookings.update_one(
        {"id": body.booking_id},
        {"$set": {"payment_status": "token_paid", "amount_paid": new_amount_paid,
                  "status": "pending_artist",
                  "expires_at": expires_at,
                  "confirmation_deadline_hours": _confirm_hours},
         "$push": {"history": {"at": utcnow(), "action": "paid_token", "by": user["id"], "amount": pay["amount"], "gateway": pay.get("gateway")}}},
    )
    # BookTalent (lead-generation model): the customer's payment is only the
    # Platform Service Fee + GST — money owed to BookTalent. No artist wallet
    # exists; the Artist Performance Fee is settled directly Customer ↔ Artist.
    # Customer ledger (audit only)
    await db.transactions.insert_one({
        "id": new_id(), "user_id": user["id"], "type": "payment",
        "amount": -pay["amount"], "status": "completed",
        "description": f"Token paid for booking {booking['ref']}",
        "booking_id": booking["id"], "gateway": pay.get("gateway"),
        "created_at": utcnow(),
    })
    # Notify artist
    await db.notifications.insert_one({
        "id": new_id(), "user_id": booking["artist_id"], "type": "booking_request",
        "title": "New paid booking request",
        "body": f"₹{pay['amount']} token received for booking {booking['ref']}",
        "read": False, "created_at": utcnow(),
        "link": f"/dashboard/bookings/{booking['id']}",
    })
    return {"ok": True, "status": "pending_artist", "booking_ref": booking["ref"], "gateway": pay.get("gateway")}


@api.post("/payments/webhook")
async def razorpay_webhook(request: Request):
    """Razorpay webhook handler. Verifies signature and updates booking state."""
    body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    if not RAZORPAY_ENABLED:
        return {"ok": False, "reason": "razorpay_disabled"}
    if not RAZORPAY_WEBHOOK_SECRET:
        return {"ok": False, "reason": "webhook_secret_missing"}

    expected = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Invalid signature")

    import json
    try:
        payload = json.loads(body.decode())
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    event = payload.get("event")
    entity = payload.get("payload", {})
    log.info(f"Razorpay webhook: {event}")

    if event == "payment.captured":
        payment_entity = entity.get("payment", {}).get("entity", {})
        order_id = payment_entity.get("order_id")
        if order_id:
            await db.payments.update_one(
                {"razorpay_order_id": order_id},
                {"$set": {"webhook_captured_at": utcnow(), "webhook_event": event}},
            )
    elif event in ("payment.failed",):
        payment_entity = entity.get("payment", {}).get("entity", {})
        order_id = payment_entity.get("order_id")
        if order_id:
            await db.payments.update_one(
                {"razorpay_order_id": order_id},
                {"$set": {"status": "failed", "webhook_event": event, "failure_reason": payment_entity.get("error_description")}},
            )

    return {"ok": True, "event": event}


@api.post("/payments/{payment_id}/refund")
async def refund_payment(payment_id: str, body: dict, user: dict = Depends(admin_only)):
    pay = await db.payments.find_one({"id": payment_id})
    if not pay:
        raise HTTPException(404, "Payment not found")
    amount = float(body.get("amount") or pay["amount"])
    if pay.get("gateway") == "razorpay" and pay.get("razorpay_payment_id") and RAZORPAY_ENABLED:
        try:
            refund = razorpay_client.payment.refund(pay["razorpay_payment_id"], {
                "amount": int(round(amount * 100)),
                "notes": {"reason": body.get("reason") or "admin_refund"},
            })
            await db.payments.update_one({"id": payment_id}, {"$set": {"refund_id": refund.get("id"), "refunded_at": utcnow(), "status": "refunded"}})
        except Exception as e:
            raise HTTPException(502, f"Refund failed: {e}")
    else:
        await db.payments.update_one({"id": payment_id}, {"$set": {"status": "refunded", "refunded_at": utcnow()}})

    # Audit-only ledger row — the actual money-back happened via Razorpay above.
    await db.transactions.insert_one({
        "id": new_id(), "user_id": pay["user_id"], "type": "refund",
        "amount": amount, "status": "completed",
        "description": f"Refund processed for payment {payment_id}",
        "created_at": utcnow(),
    })
    return {"ok": True, "amount": amount}


# ─────────────────────────────────────────────────────────────────────────────
# REVIEWS
# ─────────────────────────────────────────────────────────────────────────────
# ── Reviews endpoints moved to routes/reviews.py (Iter 13) ───────────────────


# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICATIONS / MESSAGES
# ─────────────────────────────────────────────────────────────────────────────
@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    docs = await db.notifications.find({"user_id": user["id"]}).sort("created_at", -1).limit(50).to_list(50)
    return [clean(d) for d in docs]


@api.post("/notifications/read-all")
async def read_all_notifications(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/notifications/{nid}/read")
async def read_notification(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/messages")
async def send_message(body: MessageBody, user: dict = Depends(get_current_user)):
    mid = new_id()
    # find or create conversation
    convo = await db.conversations.find_one({"participants": {"$all": [user["id"], body.to_user_id]}})
    if not convo:
        cid = new_id()
        await db.conversations.insert_one({
            "id": cid, "participants": [user["id"], body.to_user_id],
            "booking_id": body.booking_id, "last_message": body.text,
            "created_at": utcnow(), "updated_at": utcnow(),
        })
    else:
        cid = convo["id"]
        await db.conversations.update_one({"id": cid}, {"$set": {"last_message": body.text, "updated_at": utcnow()}})

    await db.messages.insert_one({
        "id": mid, "conversation_id": cid, "from_user_id": user["id"], "to_user_id": body.to_user_id,
        "text": body.text, "booking_id": body.booking_id, "read": False, "created_at": utcnow(),
    })
    await db.notifications.insert_one({
        "id": new_id(), "user_id": body.to_user_id, "type": "message",
        "title": "New message", "body": body.text[:80], "read": False, "created_at": utcnow(),
        "link": "/dashboard/messages",
    })
    return {"id": mid, "conversation_id": cid}


@api.get("/conversations")
async def list_conversations(user: dict = Depends(get_current_user)):
    docs = await db.conversations.find({"participants": user["id"]}).sort("updated_at", -1).to_list(100)
    # enrich with other party name
    out = []
    for c in docs:
        other_id = [p for p in c["participants"] if p != user["id"]][0] if len(c["participants"]) > 1 else user["id"]
        other = await db.users.find_one({"id": other_id})
        unread = await db.messages.count_documents({"conversation_id": c["id"], "to_user_id": user["id"], "read": False})
        out.append({**clean(c), "other": clean(other), "unread": unread})
    return out


@api.get("/conversations/{cid}/messages")
async def conversation_messages(cid: str, user: dict = Depends(get_current_user)):
    convo = await db.conversations.find_one({"id": cid})
    if not convo or user["id"] not in convo["participants"]:
        raise HTTPException(403, "Forbidden")
    msgs = await db.messages.find({"conversation_id": cid}).sort("created_at", 1).to_list(500)
    # mark received as read
    await db.messages.update_many({"conversation_id": cid, "to_user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return [clean(m) for m in msgs]


# ─────────────────────────────────────────────────────────────────────────────
# KYC — moved to routes/kyc.py (Iter 13)
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# ADMIN
# ─────────────────────────────────────────────────────────────────────────────
@api.get("/admin/stats")
async def admin_stats(_: dict = Depends(require_permission("analytics.view"))):
    # BookTalent is a lead-generation marketplace. We surface the marketplace
    # volume (artist fees — informational) and, most importantly, what the
    # platform actually collects: Platform Service Fee + GST.
    total_gmv = 0.0          # marketplace volume (artist fees only — not BT revenue)
    platform_rev = 0.0       # what BT invoiced (platform_fee only — net of GST)
    gst_collected = 0.0
    async for b in db.bookings.find({"status": {"$in": ["confirmed", "completed", "reviewed", "started", "completed_by_artist"]}}):
        p = b.get("pricing", {}) or {}
        total_gmv += float(p.get("artist_fee", p.get("package_fee", 0) + p.get("addons_total", 0)))
        platform_rev += float(p.get("platform_fee", 0))
        gst_collected += float(p.get("gst", 0))

    # Subscription + boost revenue — direct platform income streams.
    subs_rev = 0.0
    async for s in db.subscriptions.find({"status": {"$in": ["active", "expired"]}}):
        subs_rev += float(s.get("price_paid", 0) or s.get("price", 0) or 0)
    boost_rev = 0.0
    async for bs in db.boost_subscriptions.find({"status": {"$in": ["active", "expired"]}}):
        boost_rev += float(bs.get("price_paid", 0) or (bs.get("package_snapshot") or {}).get("price", 0) or 0)

    total_bookings = await db.bookings.count_documents({})
    pending_bookings = await db.bookings.count_documents({"status": {"$in": ["pending_artist", "pending_payment"]}})
    today = datetime.now().strftime("%Y-%m-%d")
    bookings_today = await db.bookings.count_documents({"created_at": {"$gte": today}})
    total_users = await db.users.count_documents({})
    total_artists = await db.users.count_documents({"role": "artist"})
    total_customers = await db.users.count_documents({"role": "customer"})
    open_disputes = await db.disputes.count_documents({"status": "open"})
    pending_refunds = await db.payments.count_documents({"refund_pending": True, "status": "completed"})
    pending_kyc = await db.kyc_submissions.count_documents({"status": "pending"})

    # avg rating
    avgs = await db.artist_profiles.find({"rating_avg": {"$gt": 0}}).to_list(1000)
    avg_rating = (sum(a["rating_avg"] for a in avgs) / len(avgs)) if avgs else 0

    return {
        "gmv": total_gmv,                       # marketplace artist-fee volume (informational)
        "platform_revenue": round(platform_rev, 2),  # BookTalent net platform fee earnings
        "gst_collected": round(gst_collected, 2),
        "subscription_revenue": round(subs_rev, 2),
        "boost_revenue": round(boost_rev, 2),
        "bookTalent_total_collected": round(platform_rev + gst_collected + subs_rev + boost_rev, 2),
        "total_bookings": total_bookings,
        "pending_bookings": pending_bookings,
        "bookings_today": bookings_today,
        "total_users": total_users,
        "total_artists": total_artists,
        "total_customers": total_customers,
        "open_disputes": open_disputes,
        "pending_refunds": pending_refunds,
        "pending_kyc": pending_kyc,
        "avg_rating": round(avg_rating, 2),
    }


@api.get("/admin/artists")
async def admin_list_artists(status: Optional[str] = None, _: dict = Depends(admin_only)):
    q: dict = {}
    if status == "pending":
        q["kyc_status"] = "pending"
    elif status == "verified":
        q["kyc_status"] = "approved"
    elif status == "featured":
        q["is_featured"] = True
    docs = await db.artist_profiles.find(q).to_list(500)
    out = []
    for p in docs:
        p = clean(p)
        u = await db.users.find_one({"id": p["user_id"]})
        p["user"] = clean(u) if u else None
        out.append(p)
    return out


@api.get("/admin/bookings")
async def admin_bookings(status: Optional[str] = None, _: dict = Depends(admin_only)):
    q: dict = {} if not status else {"status": status}
    docs = await db.bookings.find(q).sort("created_at", -1).to_list(500)
    return [clean(d) for d in docs]


# ── Admin 24-Hr Confirmation window overrides ────────────────────────────
class _BookingOverride(BaseModel):
    hours: Optional[int] = None
    reason: Optional[str] = None


@api.post("/admin/bookings/{bid}/extend")
async def admin_booking_extend(bid: str, body: _BookingOverride, admin: dict = Depends(admin_only)):
    """Extend the 24-hour Artist Confirmation window by `hours`."""
    doc = await db.bookings.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] not in ("pending_artist", "pending_payment"):
        raise HTTPException(400, "Booking is not pending confirmation")
    hours = max(1, int(body.hours or 24))
    current_expiry = doc.get("expires_at")
    try:
        base = datetime.fromisoformat(current_expiry) if current_expiry else datetime.now(timezone.utc)
    except Exception:
        base = datetime.now(timezone.utc)
    new_expiry = (base + timedelta(hours=hours)).isoformat()
    await db.bookings.update_one({"id": bid}, {
        "$set": {"expires_at": new_expiry},
        "$push": {"history": {"at": utcnow(), "action": "admin_extend", "by": admin["id"],
                               "hours": hours, "reason": body.reason or ""}},
    })
    return {"ok": True, "expires_at": new_expiry, "extended_by_hours": hours}


@api.post("/admin/bookings/{bid}/force-accept")
async def admin_booking_force_accept(bid: str, body: _BookingOverride, admin: dict = Depends(admin_only)):
    """Admin forces booking into Confirmed state on artist's behalf."""
    doc = await db.bookings.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] not in ("pending_artist", "pending_payment"):
        raise HTTPException(400, "Booking is not pending confirmation")
    await db.bookings.update_one({"id": bid}, {
        "$set": {"status": "confirmed", "confirmed_at": utcnow(), "confirmed_by_admin": True},
        "$push": {"history": {"at": utcnow(), "action": "admin_force_accept", "by": admin["id"],
                               "reason": body.reason or ""}},
    })
    await _create_contract(doc)
    await db.availability.update_one(
        {"user_id": doc["artist_id"], "date": doc["event_date"]},
        {"$set": {"id": new_id(), "user_id": doc["artist_id"], "date": doc["event_date"],
                  "status": "booked", "booking_id": doc["id"]}},
        upsert=True,
    )
    return {"ok": True, "status": "confirmed"}


@api.post("/admin/bookings/{bid}/force-reject")
async def admin_booking_force_reject(bid: str, body: _BookingOverride, admin: dict = Depends(admin_only)):
    """Admin forces booking into Rejected state; Platform Service Fee flagged for refund."""
    doc = await db.bookings.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc["status"] not in ("pending_artist", "pending_payment", "confirmed"):
        raise HTTPException(400, "Booking cannot be force-rejected in its current state")
    await db.bookings.update_one({"id": bid}, {
        "$set": {"status": "rejected", "rejected_at": utcnow(), "rejected_by_admin": True},
        "$push": {"history": {"at": utcnow(), "action": "admin_force_reject", "by": admin["id"],
                               "reason": body.reason or ""}},
    })
    if doc.get("amount_paid", 0) > 0:
        await _mark_platform_fee_refundable(doc, body.reason or f"Admin force-reject for {doc.get('ref', bid)}")
    return {"ok": True, "status": "rejected"}


@api.post("/admin/bookings/{bid}/manual-refund")
async def admin_booking_manual_refund(bid: str, body: _BookingOverride, admin: dict = Depends(admin_only)):
    """
    Admin manually flags a booking's payment for refund. Actual money-back is
    processed via the Razorpay refund API (or manual bank transfer in mock mode).
    """
    doc = await db.bookings.find_one({"id": bid})
    if not doc:
        raise HTTPException(404, "Not found")
    if doc.get("amount_paid", 0) <= 0:
        raise HTTPException(400, "No amount was collected for this booking")
    await _mark_platform_fee_refundable(doc, body.reason or f"Manual refund by admin for {doc.get('ref', bid)}")
    await db.bookings.update_one({"id": bid}, {
        "$push": {"history": {"at": utcnow(), "action": "admin_manual_refund", "by": admin["id"],
                               "reason": body.reason or ""}},
    })
    return {"ok": True, "refund_pending": True}


@api.get("/admin/users")
async def admin_users(role: Optional[str] = None, include_deleted: bool = False, _: dict = Depends(require_permission("users.view"))):
    q: dict = {} if not role else {"role": role}
    if not include_deleted:
        q["deleted"] = {"$ne": True}
    docs = await db.users.find(q).sort("created_at", -1).to_list(500)
    return [clean(d) for d in docs]


# ═══════════════════════════════════════════════════════════════════════════
# Iter 55 — Admin RBAC: multiple admins with per-permission access control
# ═══════════════════════════════════════════════════════════════════════════
class AdminCreateBody(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    admin_role: str = "viewer"          # one of ADMIN_ROLE_PRESETS or "custom"
    admin_permissions: Optional[List[str]] = None  # required when admin_role == "custom"


class AdminUpdateBody(BaseModel):
    admin_role: Optional[str] = None
    admin_permissions: Optional[List[str]] = None
    active: Optional[bool] = None
    password: Optional[str] = None      # super-admin can reset another admin's password


@api.get("/admin/rbac/roles")
async def admin_rbac_roles(_: dict = Depends(admin_only)):
    """List all available permissions + preset roles. Any admin can read this
    so the UI can render permission checklists — write endpoints are still gated."""
    return {
        "permissions": ADMIN_PERMISSIONS,
        "role_presets": ADMIN_ROLE_PRESETS,
    }


@api.get("/admin/rbac/me")
async def admin_rbac_me(admin: dict = Depends(admin_only)):
    """Return the caller's own RBAC permissions so the frontend can hide
    modules the current admin doesn't have access to."""
    if admin.get("admin_role") == "super_admin":
        perms = ADMIN_PERMISSIONS
    else:
        perms = admin.get("admin_permissions") or ADMIN_PERMISSIONS
    return {
        "admin_role": admin.get("admin_role", "super_admin"),
        "admin_permissions": perms,
    }


@api.get("/admin/admins")
async def admin_list_admins(_: dict = Depends(require_permission("admins.manage"))):
    docs = await db.users.find({"role": "admin", "deleted": {"$ne": True}}).sort("created_at", 1).to_list(200)
    return [{
        "id": d["id"],
        "email": d["email"],
        "first_name": d.get("first_name"),
        "last_name": d.get("last_name"),
        "admin_role": d.get("admin_role") or "super_admin",  # legacy = super
        "admin_permissions": d.get("admin_permissions") or ADMIN_PERMISSIONS,
        "active": not d.get("suspended", False),
        "created_at": d.get("created_at"),
    } for d in docs]


@api.post("/admin/admins")
async def admin_create_admin(body: AdminCreateBody, super_admin: dict = Depends(require_permission("admins.manage"))):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email already in use")

    # Resolve permission set: preset role OR explicit permission list.
    if body.admin_role == "custom":
        if not body.admin_permissions:
            raise HTTPException(400, "admin_permissions required for custom role")
        permissions = [p for p in body.admin_permissions if p in ADMIN_PERMISSIONS]
    elif body.admin_role in ADMIN_ROLE_PRESETS:
        permissions = ADMIN_ROLE_PRESETS[body.admin_role]
    else:
        raise HTTPException(400, f"Unknown role '{body.admin_role}'")

    # Only super_admin can mint another super_admin (belt-and-braces beyond
    # the require_permission gate — 'admins.manage' is the same key).
    if body.admin_role == "super_admin" and super_admin.get("admin_role") != "super_admin":
        raise HTTPException(403, "Only a super admin can create another super admin")

    doc = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(body.password),
        "first_name": (body.first_name or "").strip() or "Admin",
        "last_name": (body.last_name or "").strip() or "",
        "role": "admin",
        "admin_role": body.admin_role,
        "admin_permissions": permissions,
        "kyc_status": "approved",
        "verified": True,
        "created_by_admin_id": super_admin["id"],
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await db.users.insert_one(doc)
    return {
        "id": doc["id"], "email": doc["email"], "admin_role": doc["admin_role"],
        "admin_permissions": doc["admin_permissions"], "active": True,
    }


@api.patch("/admin/admins/{uid}")
async def admin_update_admin(uid: str, body: AdminUpdateBody, super_admin: dict = Depends(require_permission("admins.manage"))):
    target = await db.users.find_one({"id": uid, "role": "admin"})
    if not target:
        raise HTTPException(404, "Admin not found")
    if uid == super_admin["id"] and body.admin_role and body.admin_role != "super_admin":
        raise HTTPException(400, "You cannot demote yourself. Ask another super admin to do it.")

    updates: Dict[str, Any] = {"updated_at": utcnow()}
    if body.admin_role is not None:
        if body.admin_role == "custom":
            if body.admin_permissions is None:
                raise HTTPException(400, "admin_permissions required for custom role")
        elif body.admin_role in ADMIN_ROLE_PRESETS:
            updates["admin_permissions"] = ADMIN_ROLE_PRESETS[body.admin_role]
        elif body.admin_role == "super_admin":
            if super_admin.get("admin_role") != "super_admin":
                raise HTTPException(403, "Only a super admin can grant super_admin")
            updates["admin_permissions"] = ADMIN_PERMISSIONS
        else:
            raise HTTPException(400, f"Unknown role '{body.admin_role}'")
        updates["admin_role"] = body.admin_role

    if body.admin_permissions is not None:
        updates["admin_permissions"] = [p for p in body.admin_permissions if p in ADMIN_PERMISSIONS]

    if body.active is not None:
        # Prevent locking yourself out of the last super_admin seat.
        if not body.active and uid == super_admin["id"]:
            raise HTTPException(400, "You cannot deactivate yourself")
        updates["suspended"] = not body.active

    if body.password:
        updates["password_hash"] = hash_password(body.password)

    await db.users.update_one({"id": uid}, {"$set": updates})
    return {"ok": True}


@api.delete("/admin/admins/{uid}")
async def admin_delete_admin(uid: str, super_admin: dict = Depends(require_permission("admins.manage"))):
    if uid == super_admin["id"]:
        raise HTTPException(400, "You cannot delete yourself")
    target = await db.users.find_one({"id": uid, "role": "admin"})
    if not target:
        raise HTTPException(404, "Admin not found")
    # Guard the last super admin — refuse to delete if it's the only one.
    if target.get("admin_role") == "super_admin":
        remaining = await db.users.count_documents({"role": "admin", "admin_role": "super_admin", "id": {"$ne": uid}, "deleted": {"$ne": True}})
        if remaining == 0:
            raise HTTPException(400, "Cannot delete the last super admin. Promote another admin first.")
    await db.users.update_one({"id": uid}, {"$set": {"deleted": True, "suspended": True, "updated_at": utcnow()}})
    return {"ok": True}


# /admin/kyc and /admin/kyc/decide moved to routes/kyc.py (Iter 13)


@api.post("/admin/artists/{user_id}/feature")
async def admin_feature(user_id: str, _: dict = Depends(require_permission("artists.moderate"))):
    a = await db.artist_profiles.find_one({"user_id": user_id})
    if not a:
        raise HTTPException(404, "Not found")
    await db.artist_profiles.update_one({"user_id": user_id}, {"$set": {"is_featured": not a.get("is_featured", False)}})
    return {"ok": True}


@api.post("/admin/artists/{user_id}/suspend")
async def admin_suspend(user_id: str, _: dict = Depends(require_permission("users.suspend"))):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "Not found")
    suspended = not u.get("suspended", False)
    # Iter 52.8 — Mirror the suspension flag onto artist_profiles so the
    # public search/featured/quote/spotlight queries can filter it out with a
    # single index-friendly clause (`suspended: {$ne: true}`). Without this
    # mirror the flag lived only on `users` and every public read continued
    # to surface a suspended artist — the exact bug the user just reported.
    await db.users.update_one({"id": user_id}, {"$set": {"suspended": suspended}})
    await db.artist_profiles.update_one({"user_id": user_id}, {"$set": {"suspended": suspended}})
    return {"ok": True, "suspended": suspended}


# ─── Admin: edit / delete any user (Iter 40) ─────────────────────────────────
class AdminUserEditBody(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[Literal["customer", "artist", "agency", "corporate", "admin"]] = None
    # Artist-profile-only fields
    stage_name: Optional[str] = None
    category: Optional[str] = None
    city: Optional[str] = None
    starting_price: Optional[float] = None
    bio: Optional[str] = None


@api.put("/admin/users/{user_id}")
async def admin_edit_user(user_id: str, body: AdminUserEditBody, _: dict = Depends(require_permission("users.edit"))):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "User not found")

    user_updates: Dict[str, Any] = {}
    for k in ("first_name", "last_name", "phone", "role"):
        v = getattr(body, k)
        if v is not None:
            user_updates[k] = v
    if body.email is not None:
        e = body.email.strip().lower()
        clash = await db.users.find_one({"email": e, "id": {"$ne": user_id}})
        if clash:
            raise HTTPException(400, "Email already in use")
        user_updates["email"] = e
    if user_updates:
        user_updates["updated_at"] = utcnow()
        await db.users.update_one({"id": user_id}, {"$set": user_updates})

    profile_updates: Dict[str, Any] = {}
    for k in ("stage_name", "category", "city", "starting_price", "bio"):
        v = getattr(body, k)
        if v is not None:
            profile_updates[k] = v
    if profile_updates and (u.get("role") == "artist" or body.role == "artist"):
        profile_updates["updated_at"] = utcnow()
        await db.artist_profiles.update_one({"user_id": user_id}, {"$set": profile_updates})
        # Keep SEO slug fresh when identifying fields change.
        if any(k in profile_updates for k in ("stage_name", "category", "city")):
            from routes.cms_seo import artist_slug as _mk_slug
            prof = await db.artist_profiles.find_one({"user_id": user_id}) or {}
            if prof.get("stage_name"):
                await db.artist_profiles.update_one(
                    {"user_id": user_id}, {"$set": {"slug": _mk_slug(prof)}}
                )
    return {"ok": True}


@api.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, hard: bool = False, admin: dict = Depends(require_permission("users.delete"))):
    """
    Delete a user account.
      • hard=false  → soft delete: mark deleted + anonymise email, keep history
      • hard=true   → wipe the user + role profile + owned artifacts. Bookings
                      are preserved (foreign-key value only) so financial
                      records stay intact.
    Admins cannot delete themselves.
    """
    if user_id == admin["id"]:
        raise HTTPException(400, "You cannot delete your own admin account")
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "User not found")

    if not hard:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {
                "suspended": True,
                "deleted": True,
                "deleted_at": utcnow(),
                "email": f"deleted-{user_id[:8]}@booktalent.deleted",
            }},
        )
        return {"ok": True, "mode": "soft"}

    # Hard delete — remove user document + role-specific data.
    await db.users.delete_one({"id": user_id})
    for coll in ("artist_profiles", "agencies", "corporate_profiles", "customer_profiles",
                 "kyc_submissions", "subscriptions", "boost_subscriptions",
                 "packages", "media", "notifications", "announcement_reads",
                 "reviews", "onboarding_progress"):
        try:
            await db[coll].delete_many({"user_id": user_id})
        except Exception:
            pass
    # Reviews referencing the user by artist_id
    await db.reviews.delete_many({"artist_id": user_id})
    return {"ok": True, "mode": "hard"}


@api.get("/admin/refunds")
async def admin_refunds(_: dict = Depends(admin_only)):
    """Payments flagged for refund (booking cancelled/rejected). Admin
    processes the actual Razorpay refund via /payments/{id}/refund."""
    docs = await db.payments.find({"refund_pending": True, "status": "completed"}).sort("refund_flagged_at", -1).to_list(500)
    out = []
    for d in docs:
        d = clean(d)
        u = await db.users.find_one({"id": d.get("user_id")})
        d["user"] = clean(u) if u else None
        out.append(d)
    return out


# COUPONS
async def _validate_coupon(code: str, *, user_id: str, base_amount: float, event_type: Optional[str] = None) -> tuple[dict, float]:
    """Returns (coupon_doc, discount_amount) or raises 400."""
    c = await db.coupons.find_one({"code": code.upper()})
    if not c:
        raise HTTPException(404, "Invalid coupon code")
    if not c.get("active", False):
        raise HTTPException(400, "Coupon is inactive")
    # Expiry
    try:
        exp = c.get("expires_at", "")
        if exp and exp < datetime.now(timezone.utc).strftime("%Y-%m-%d"):
            raise HTTPException(400, "Coupon has expired")
    except HTTPException:
        raise
    except Exception:
        pass
    # Min order
    if base_amount < float(c.get("min_order", 0)):
        raise HTTPException(400, f"Order must be at least ₹{c.get('min_order', 0)} to use this coupon")
    # Max uses
    if c.get("usage_count", 0) >= int(c.get("max_uses", 1000)):
        raise HTTPException(400, "Coupon usage limit reached")
    # Per-user limit
    per_user_used = await db.coupon_redemptions.count_documents({"coupon_id": c["id"], "user_id": user_id})
    if per_user_used >= int(c.get("per_user_limit", 1)):
        raise HTTPException(400, "You've already used this coupon the maximum number of times")
    # applies_to
    applies_to = c.get("applies_to", "all")
    if applies_to != "all" and event_type and applies_to.lower() != event_type.lower():
        raise HTTPException(400, f"Coupon valid only for {applies_to} bookings")
    # Compute discount
    if c["discount_type"] == "percent":
        discount = round(base_amount * float(c["discount_value"]) / 100, 2)
    else:
        discount = float(c["discount_value"])
    discount = min(discount, base_amount)  # never exceed base
    return c, discount


# ── Coupons / Blogs / Disputes endpoints moved to routes/ (Iter 13) ──────────


# CONTRACTS
@api.get("/contracts/mine")
async def my_contracts(user: dict = Depends(get_current_user)):
    if user["role"] == "admin":
        q = {}
    elif user["role"] == "artist":
        q = {"artist_id": user["id"]}
    else:
        q = {"customer_id": user["id"]}
    docs = await db.contracts.find(q).sort("created_at", -1).to_list(500)
    return [clean(d) for d in docs]


@api.get("/contracts/{cid}")
async def get_contract(cid: str, user: dict = Depends(get_current_user)):
    doc = await db.contracts.find_one({"id": cid})
    if not doc:
        raise HTTPException(404, "Not found")
    if user["role"] != "admin" and user["id"] not in (doc["artist_id"], doc["customer_id"]):
        raise HTTPException(403, "Forbidden")
    return clean(doc)


@api.get("/contracts/{cid}/pdf")
async def download_contract_pdf(cid: str, user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": cid})
    if not contract:
        raise HTTPException(404, "Contract not found")
    if user["role"] != "admin" and user["id"] not in (contract["artist_id"], contract["customer_id"]):
        raise HTTPException(403, "Forbidden")
    booking = await db.bookings.find_one({"id": contract["booking_id"]})
    artist_user = await db.users.find_one({"id": contract["artist_id"]}) or {}
    artist_profile = await db.artist_profiles.find_one({"user_id": contract["artist_id"]}) or {}
    customer = await db.users.find_one({"id": contract["customer_id"]}) or {}
    artist_merged = {**artist_user, **artist_profile}
    pdf_bytes = generate_contract_pdf(booking, artist_merged, customer, contract)
    filename = f"contract_{contract.get('ref', cid[:8])}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api.get("/bookings/{bid}/invoice")
async def download_invoice_pdf(bid: str, user: dict = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": bid})
    if not booking:
        raise HTTPException(404, "Booking not found")
    if user["role"] != "admin" and user["id"] not in (booking["customer_id"], booking["artist_id"]):
        raise HTTPException(403, "Forbidden")
    # Iter 53 — The Platform Service Fee invoice is a BookTalent-to-Customer
    # document. Artists must not download it (contains platform fee + GST
    # they shouldn't see).
    if user["role"] == "artist":
        raise HTTPException(403, "Platform invoices are issued only to the customer.")
    artist_user = await db.users.find_one({"id": booking["artist_id"]}) or {}
    artist_profile = await db.artist_profiles.find_one({"user_id": booking["artist_id"]}) or {}
    pdf_bytes = generate_invoice_pdf(booking, {**artist_user, **artist_profile})
    filename = f"invoice_{booking.get('ref', bid[:8])}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Counter-offer endpoint removed — BookTalent enforces fixed pricing.


# Upload signed contract (artist or customer)
class UploadSignedBody(BaseModel):
    contract_id: str
    data_url: str
    signed_by: Literal["artist", "customer"]


@api.post("/contracts/upload-signed")
async def upload_signed_contract(body: UploadSignedBody, user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": body.contract_id})
    if not contract:
        raise HTTPException(404, "Contract not found")
    if user["id"] not in (contract["artist_id"], contract["customer_id"]) and user["role"] != "admin":
        raise HTTPException(403, "Forbidden")
    if not body.data_url.startswith("data:"):
        raise HTTPException(400, "Invalid data URL")
    header, b64 = body.data_url.split(",", 1)
    mime = header.split(";")[0].replace("data:", "")
    raw = base64.b64decode(b64)
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 25 MB)")
    mid = new_id()
    await db.media.insert_one({
        "id": mid, "user_id": user["id"], "type": "document",
        "mime": mime, "data": b64, "size": len(raw),
        "title": f"signed_contract_{contract.get('ref')}_{body.signed_by}",
        "contract_id": body.contract_id, "created_at": utcnow(),
    })
    # Add to contract's version history
    sig_field = f"signed_{body.signed_by}_media_id"
    await db.contracts.update_one(
        {"id": body.contract_id},
        {"$set": {sig_field: mid, f"signed_{body.signed_by}_at": utcnow()},
         "$push": {"history": {"action": "uploaded_signed", "by": user["id"], "media_id": mid, "at": utcnow()}}},
    )
    # If both signed, flip to fully_signed
    fresh = await db.contracts.find_one({"id": body.contract_id})
    if fresh.get("signed_artist_media_id") and fresh.get("signed_customer_media_id"):
        await db.contracts.update_one(
            {"id": body.contract_id},
            {"$set": {"status": "fully_signed", "fully_signed_at": utcnow()}},
        )
    return {"ok": True, "media_id": mid}


# BOOST
@api.post("/boost/activate")
async def activate_boost(body: BoostBody, user: dict = Depends(get_current_user)):
    plans = {"starter": (999, 7), "pro": (2499, 30), "elite": (7499, 90)}
    if body.plan not in plans:
        raise HTTPException(400, "Invalid plan")
    price, days = plans[body.plan]
    expires = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    await db.artist_profiles.update_one(
        {"user_id": user["id"]},
        {"$set": {"is_boosted": True, "boost_expires": expires, "boost_plan": body.plan}},
    )
    await db.transactions.insert_one({
        "id": new_id(), "user_id": user["id"], "type": "boost",
        "amount": -price, "status": "completed",
        "description": f"Boost plan {body.plan} activated for {days} days",
        "created_at": utcnow(),
    })
    return {"ok": True, "expires": expires}


# ANALYTICS (artist self)
@api.get("/analytics/me")
async def my_analytics(user: dict = Depends(get_current_user)):
    if user["role"] == "artist":
        profile = await db.artist_profiles.find_one({"user_id": user["id"]}) or {}
        bookings = await db.bookings.find({"artist_id": user["id"]}).to_list(5000)
        total_earnings = sum(
            float(b.get("pricing", {}).get("package_fee", 0)) + float(b.get("pricing", {}).get("addons_total", 0))
            for b in bookings if b.get("status") in ("completed", "reviewed")
        )
        pending = sum(
            float(b.get("pricing", {}).get("token_amount", 0))
            for b in bookings if b.get("status") in ("confirmed", "started", "completed_by_artist")
        )
        return {
            "earnings": total_earnings,
            "total_bookings": len(bookings),
            "pending_requests": sum(1 for b in bookings if b.get("status") in ("pending_artist", "pending_payment")),
            "profile_views": profile.get("profile_views", 0),
            "rating": profile.get("rating_avg", 0),
            "reviews": profile.get("review_count", 0),
            "events_done": profile.get("events_done", 0),
            "pending_amount": pending,
        }
    else:
        bookings = await db.bookings.find({"customer_id": user["id"]}).to_list(5000)
        total_spent = sum(float(b.get("amount_paid", 0)) for b in bookings)
        return {
            "total_spent": total_spent,
            "total_bookings": len(bookings),
            "completed": sum(1 for b in bookings if b.get("status") in ("completed", "reviewed")),
            "upcoming": sum(1 for b in bookings if b.get("status") in ("confirmed", "started")),
        }


# ─────────────────────────────────────────────────────────────────────────────
# SEED & STARTUP
# ─────────────────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    # indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.artist_profiles.create_index("user_id", unique=True)
    await db.bookings.create_index("id", unique=True)
    await db.bookings.create_index("artist_id")
    await db.bookings.create_index("customer_id")
    await db.bookings.create_index([("status", 1), ("expires_at", 1)])
    await db.coupons.create_index("code", unique=True)
    await db.media.create_index("user_id")
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

    # seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@booktalent.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": new_id(), "email": admin_email,
            "password_hash": hash_password(admin_password),
            "first_name": "Super", "last_name": "Admin",
            "role": "admin",
            "admin_role": "super_admin",
            "admin_permissions": ADMIN_PERMISSIONS,
            "kyc_status": "approved", "verified": True,
            "created_at": utcnow(), "updated_at": utcnow(),
        })
    else:
        upd = {}
        if not verify_password(admin_password, existing.get("password_hash", "")):
            upd["password_hash"] = hash_password(admin_password)
        # Backfill RBAC fields for the legacy seed admin so it becomes the super admin.
        if not existing.get("admin_role"):
            upd["admin_role"] = "super_admin"
            upd["admin_permissions"] = ADMIN_PERMISSIONS
        if upd:
            await db.users.update_one({"email": admin_email}, {"$set": upd})

    # seed demo data only once
    seed_marker = await db.meta.find_one({"_id": "seed_v3"})
    if not seed_marker:
        await _seed_demo()
        await db.meta.insert_one({"_id": "seed_v3", "seeded_at": utcnow()})
    log.info("BookTalent API ready")
    # Start the 24-hr Artist Confirmation auto-expiry background loop.
    asyncio.create_task(_auto_expire_loop())


async def _seed_demo():
    """Seed demo artists, packages, reviews so the app is not empty."""
    log.info("Seeding demo data…")
    artists = [
        ("priya@booktalent.com", "Priya", "Sharma", "Bollywood Vocalist", "Mumbai", "🎤", True,
         "Award-winning Bollywood vocalist with 8 years of experience. Performed at 300+ events.", 4.9, 284, 312,
         [("Acoustic Solo", 35000, "2 hours", ["20 songs", "Own setup", "1 dedication"], False),
          ("Premium Bollywood", 55000, "3 hours", ["35+ songs", "Pro PA system", "Tabla player", "3 dedications"], True),
          ("Royal Concert", 120000, "5 hours", ["Live band", "Stage lighting", "LED backdrop", "Unlimited songs"], False)]),
        ("vortex@booktalent.com", "DJ", "Vortex", "DJ / Music Producer", "Delhi", "🎧", True,
         "EDM and Bollywood DJ. Performed at top clubs and 200+ events across India.", 4.8, 198, 248,
         [("Club Night", 40000, "4 hours", ["EDM + Bollywood", "Own console", "Lighting"], True),
          ("Wedding Premium", 65000, "6 hours", ["Full setup", "LED screens", "Photo wall"], False)]),
        ("rohit@booktalent.com", "Rohit", "Gupta", "Stand-up Comedian", "Bangalore", "🎭", False,
         "Award winning stand-up comedian with 6 years of experience. 100+ corporate shows.", 4.7, 156, 196,
         [("Corporate 45min", 30000, "45 mins", ["Clean comedy", "Mic + setup"], True),
          ("Festival Show", 55000, "90 mins", ["Full setlist", "Q&A", "Meet & greet"], False)]),
        ("kavya@booktalent.com", "Kavya", "Menon", "Carnatic Vocalist", "Chennai", "🎤", True,
         "Trained Carnatic vocalist blending classical with Bollywood. Pan-India performer.", 4.9, 142, 168,
         [("Classical Recital", 45000, "2 hours", ["Tanpura + Mridangam"], False),
          ("Fusion Concert", 75000, "3 hours", ["Full band", "Bollywood + Classical"], True)]),
        ("aamir@booktalent.com", "Aamir", "Qureshi", "Sufi Vocalist", "Delhi", "🎵", False,
         "Sufi & Ghazal vocalist with classical training. Soulful performances for elite events.", 4.8, 118, 142,
         [("Sufi Soiree", 60000, "2.5 hours", ["Harmonium + Tabla", "Original setlist"], True)]),
        ("deepika@booktalent.com", "Deepika", "Rao", "Ghazal Singer", "Pune", "🎶", False,
         "Ghazal and semi-classical specialist. Intimate evening performances.", 4.6, 88, 102,
         [("Intimate Evening", 38000, "2 hours", ["Acoustic", "Curated setlist"], True)]),
    ]
    for email, fn, ln, cat, city, emoji, featured, bio, rating, reviews, events, packages in artists:
        if await db.users.find_one({"email": email}):
            continue
        uid = new_id()
        now = utcnow()
        await db.users.insert_one({
            "id": uid, "email": email, "password_hash": hash_password("Artist@123"),
            "first_name": fn, "last_name": ln, "phone": f"+91 98765 {uid[:5]}",
            "role": "artist", "kyc_status": "approved", "verified": True,
            "created_at": now, "updated_at": now,
        })
        await db.artist_profiles.insert_one({
            "id": new_id(), "user_id": uid, "stage_name": f"{fn} {ln}",
            "category": cat, "subcategories": [],
            "city": city, "state": "", "country": "India",
            "bio": bio, "tagline": f"{cat} — {city}",
            "languages": ["Hindi", "English"], "genres": [cat], "event_types": ["Weddings", "Corporate"],
            "travel_range": "Pan India", "experience_years": 8, "notice_period_days": 7,
            "available_for_booking": True, "profile_image": None, "cover_image": None,
            "socials": {}, "rating_avg": rating, "review_count": reviews, "events_done": events,
            "followers": reviews * 7, "profile_views": reviews * 30,
            "is_featured": featured, "is_boosted": featured, "kyc_status": "approved",
            "emoji": emoji,
            "created_at": now, "updated_at": now,
        })
        for name, price, dur, feats, popular in packages:
            await db.packages.insert_one({
                "id": new_id(), "artist_id": uid, "name": name, "description": "",
                "price": price, "duration": dur, "features": feats, "is_popular": popular,
                "created_at": now,
            })

    # seed a demo customer
    if not await db.users.find_one({"email": "customer@booktalent.com"}):
        cid = new_id()
        await db.users.insert_one({
            "id": cid, "email": "customer@booktalent.com",
            "password_hash": hash_password("Customer@123"),
            "first_name": "Rajesh", "last_name": "Kapoor", "phone": "+91 98765 43210",
            "role": "customer", "kyc_status": "unverified", "verified": False,
            "created_at": utcnow(),
        })

    # seed a coupon
    if not await db.coupons.find_one({"code": "WEDDING20"}):
        await db.coupons.insert_one({
            "id": new_id(), "code": "WEDDING20", "description": "20% off on wedding bookings",
            "discount_type": "percent", "discount_value": 20, "max_uses": 500, "usage_count": 284,
            "expires_at": "2026-12-31", "min_order": 0, "applies_to": "wedding", "active": True,
            "created_at": utcnow(),
        })
        await db.coupons.insert_one({
            "id": new_id(), "code": "FIRST500", "description": "₹500 off first booking",
            "discount_type": "flat", "discount_value": 500, "max_uses": 1000, "usage_count": 0,
            "expires_at": "2026-12-31", "min_order": 5000, "applies_to": "all", "active": True,
            "created_at": utcnow(),
        })

    log.info("Demo data seeded.")


# ─────────────────────────────────────────────────────────────────────────────
@api.get("/")
async def root():
    return {"ok": True, "service": "BookTalent API", "version": "1.0.0"}


@api.get("/categories")
async def categories():
    return [
        {"slug": "singer", "name": "Singers & Vocalists", "icon": "🎤"},
        {"slug": "dj", "name": "DJs & Music", "icon": "🎧"},
        {"slug": "comedian", "name": "Comedians", "icon": "🎭"},
        {"slug": "dancer", "name": "Dancers", "icon": "💃"},
        {"slug": "anchor", "name": "Anchors / Emcees", "icon": "🎙️"},
        {"slug": "band", "name": "Live Bands", "icon": "🎸"},
        {"slug": "magician", "name": "Magicians", "icon": "🎩"},
        {"slug": "folk", "name": "Folk Artists", "icon": "🪕"},
    ]


@api.get("/cities")
async def cities():
    return ["Mumbai", "Delhi NCR", "Bangalore", "Chennai", "Hyderabad", "Kolkata", "Pune", "Jaipur", "Ahmedabad", "Goa"]


# ── Token-gated one-shot DB dump download (for VPS migration) ────────────
# Reads token from DUMP_DOWNLOAD_TOKEN env var (no hardcoded secret).
# Unset the env var (or delete this block) once your VPS restore is done.
import hmac as _hmac
from fastapi.responses import FileResponse as _FileResponse
_DUMP_PATH = "/app/booktalent-mongodb-dump.archive.gz"

@api.get("/ops/dump/{token}")
async def dump_download(token: str):
    expected = os.environ.get("DUMP_DOWNLOAD_TOKEN") or ""
    if not expected or not _hmac.compare_digest(token, expected):
        raise HTTPException(status_code=404, detail="Not found")
    if not os.path.exists(_DUMP_PATH):
        raise HTTPException(status_code=404, detail="Dump not available")
    return _FileResponse(
        _DUMP_PATH,
        media_type="application/gzip",
        filename="booktalent-mongodb-dump.archive.gz",
    )


# ─── Iter 47 — AI Planner "Add All To Cart" best-fit resolver ────────────────
class BestFitRequest(BaseModel):
    categories: List[str]                  # e.g. ["Singer / Vocalist", "DJ", "Anchor / MC"]
    city: Optional[str] = None
    event_date: Optional[str] = None       # ISO YYYY-MM-DD — skip artists busy that day
    budget_hint: Optional[str] = None      # ignored today, reserved for future ranking


class BestFitArtist(BaseModel):
    category: str
    user_id: Optional[str] = None
    stage_name: Optional[str] = None
    profile_image: Optional[str] = None
    starting_price: Optional[float] = None
    package_id: Optional[str] = None
    city: Optional[str] = None
    emoji: Optional[str] = None
    matched: bool = False                  # False when nothing available for this category


@api.post("/event-planner/best-fit", response_model=List[BestFitArtist])
async def event_planner_best_fit(body: BestFitRequest):
    """Resolves LLM-generated category labels into concrete artist recommendations
    (one per category) that the customer can drop into their cart in one tap.
    Never 500s — every requested category comes back with at least a stub row
    so the frontend can render a placeholder even when no artist is available."""
    if not body.categories:
        raise HTTPException(400, "categories list is required")

    city = (body.city or "").strip()
    busy_ids: set = set()
    if body.event_date:
        booked = await db.bookings.find(
            {"event_date": body.event_date,
             "status": {"$in": ["pending_artist", "confirmed", "started", "completed"]}},
            {"artist_id": 1},
        ).to_list(500)
        busy_ids = {b["artist_id"] for b in booked}

    out: List[BestFitArtist] = []
    seen_ids: set = set()

    for cat_label in body.categories:
        # The LLM emits multi-part labels like "Singer / Vocalist", "Anchor / MC".
        # Real artist_profiles.category values are things like "Bollywood Vocalist"
        # or "DJ / Music Producer". Match any of the label's alt terms as a
        # case-insensitive SUBSTRING so both directions of naming line up.
        parts = [p.strip() for p in re.split(r"[/,]", cat_label or "") if p.strip()]
        if not parts:
            out.append(BestFitArtist(category=cat_label, matched=False))
            continue
        cat_regex = "|".join(re.escape(p) for p in parts)

        q: dict = {
            "$or": [{"listing_status": {"$exists": False}}, {"listing_status": {"$ne": "hidden"}}],
            "category": {"$regex": cat_regex, "$options": "i"},
            "suspended": {"$ne": True},   # Iter 52.8 — hide suspended artists
        }
        if city:
            # Prefix match on city — accepts "Mumbai" and "Mumbai, India" alike.
            q["city"] = {"$regex": f"^{re.escape(city)}", "$options": "i"}

        profiles = await db.artist_profiles.find(q).sort(
            [("rating_avg", -1), ("bookings_count", -1)]
        ).to_list(20)

        # City fallback — if no artist in the requested city, cast a wider net
        # nationally so we always propose SOMEBODY per category.
        if not profiles and city:
            q.pop("city", None)
            profiles = await db.artist_profiles.find(q).sort(
                [("rating_avg", -1), ("bookings_count", -1)]
            ).to_list(20)

        pick: Optional[dict] = None
        for prof in profiles:
            uid = prof.get("user_id")
            if not uid or uid in seen_ids or uid in busy_ids:
                continue
            pick = prof
            break

        if not pick:
            out.append(BestFitArtist(category=cat_label, matched=False))
            continue
        seen_ids.add(pick["user_id"])

        pkgs = await db.packages.find({"artist_id": pick["user_id"]}).sort("price", 1).to_list(10)
        cheapest = pkgs[0] if pkgs else None

        out.append(BestFitArtist(
            category=cat_label,
            user_id=pick["user_id"],
            stage_name=pick.get("stage_name"),
            profile_image=pick.get("profile_image"),
            starting_price=float(cheapest["price"]) if cheapest else None,
            package_id=cheapest.get("id") if cheapest else None,
            city=pick.get("city"),
            emoji=pick.get("emoji", "🎤"),
            matched=True,
        ))

    return out




app.include_router(api)


# Iteration 7 — Enterprise routes (Admin ERP, Boost, Notifications, Advanced Search)
_iter7_router = make_iter7_router(db, get_current_user, admin_only)
app.include_router(_iter7_router, prefix="/api")

# Live chat (REST + WebSocket)
_chat_router = make_chat_router(db, get_current_user)
app.include_router(_chat_router, prefix="/api")

# Iter9 — Agency / Corporate / Chat upload / Provider wiring
_iter9_router = make_iter9_router(db, get_current_user, admin_only)
app.include_router(_iter9_router, prefix="/api")

# Iter11 — ICS calendar, CSV exports, AI semantic search
_iter11_router = make_iter11_router(db, get_current_user, admin_only)
app.include_router(_iter11_router, prefix="/api")

# Iter52 — Agency CRM (offline artists/clients/events/staff/finance).
# Note: the persistent Booking Cart shipped in Iter 52 was removed at user
# request in Iter 52.5 — the artist-profile flow is single-artist and
# customer-login-gated as before. Cart router + collection are gone.
from routes.agency_crm import make_agency_crm_router  # noqa: E402
app.include_router(make_agency_crm_router(db, get_current_user), prefix="/api")

# Iter13 — server.py modularisation. Domain routers split out for maintainability.
_common_deps = dict(db=db, utcnow=utcnow, new_id=new_id, clean=clean)
app.include_router(
    routes_reviews.make_router(get_current_user=get_current_user, admin_only=admin_only,
                               notify_dispatch=notify_dispatch, **_common_deps),
    prefix="/api",
)
app.include_router(
    routes_coupons.make_router(get_current_user=get_current_user, admin_only=admin_only,
                               validate_coupon=_validate_coupon, **_common_deps),
    prefix="/api",
)
app.include_router(
    routes_blogs.make_router(admin_only=admin_only, **_common_deps),
    prefix="/api",
)
app.include_router(
    routes_disputes.make_router(get_current_user=get_current_user, admin_only=admin_only,
                                **_common_deps),
    prefix="/api",
)
app.include_router(
    routes_kyc.make_router(get_current_user=get_current_user, admin_only=admin_only,
                           notify_dispatch=notify_dispatch, log=log, **_common_deps),
    prefix="/api",
)
# Sprint 2 — chunked / resumable filesystem uploads (up to 5 GB per file)
app.include_router(
    routes_uploads.make_router(
        get_current_user=get_current_user, log=log,
        compress_image=compress_image, make_thumbnail=make_thumbnail,
        **_common_deps,
    ),
    prefix="/api",
)
# Sprint 3 — artist-defined add-ons
app.include_router(
    routes_addons.make_router(get_current_user=get_current_user, **_common_deps),
    prefix="/api",
)
# Sprint 5 — premium subscription plans
app.include_router(
    routes_subscriptions.make_router(
        get_current_user=get_current_user, admin_only=admin_only, **_common_deps,
    ),
    prefix="/api",
)
# Sprint 5 — dynamic homepage sections (public)
app.include_router(
    routes_homepage.make_router(get_current_user_optional=get_current_user_optional, **_common_deps),
    prefix="/api",
)
# Elite Concierge Chat (Platinum + Elite gate)
app.include_router(
    routes_concierge.make_router(
        get_current_user=get_current_user, admin_only=admin_only,
        notify_dispatch=notify_dispatch, **_common_deps,
    ),
    prefix="/api",
)
# Booking Insights — artist self-service analytics
app.include_router(
    routes_insights.make_router(get_current_user=get_current_user, **_common_deps),
    prefix="/api",
)
# City-alias admin management (Iter 35)
app.include_router(
    routes_city_aliases.make_router(admin_only=admin_only, **_common_deps),
    prefix="/api",
)
# Outstation Analytics — Admin report
app.include_router(
    routes_outstation_report.make_router(admin_only=admin_only, **_common_deps),
    prefix="/api",
)
# Iter 39 — CMS pages / Dynamic Menus / FAQ Help Center / Broadcast /
# Sitemap.xml + Robots.txt / Artist slug SEO / Category & City landing.
_cms_seo_router = routes_cms_seo.make_router(
    get_current_user=get_current_user,
    get_current_user_optional=get_current_user_optional,
    admin_only=admin_only,
    **_common_deps,
)
app.include_router(_cms_seo_router, prefix="/api")

# Iter 47 — Dynamic Artist Onboarding Questionnaire (Layer 1 + Layer 2).
app.include_router(
    routes_questionnaire.make_router(
        get_current_user=get_current_user, admin_only=admin_only, **_common_deps
    ),
    prefix="/api",
)

# Iter 46 — AI Event Planner (Claude Sonnet 4.6 via Emergent Universal Key).
from routes import event_planner as routes_event_planner  # noqa: E402
app.include_router(routes_event_planner.router, prefix="/api")

# Iter 48 — Multi-Artist Event recap + summary (extracted from server.py).
from routes import events as routes_events  # noqa: E402
app.include_router(
    routes_events.make_router(db=db, get_current_user=get_current_user, clean=clean),
    prefix="/api",
)

# Iter 50 — Save-a-Watch (filter combos → notification when a new artist matches).
from routes import watches as routes_watches  # noqa: E402
app.include_router(
    routes_watches.make_router(db=db, get_current_user=get_current_user, utcnow=utcnow),
    prefix="/api",
)


@app.on_event("startup")
async def _iter7_startup():
    await _iter7_router.seed()
    await _cms_seo_router.seed()  # Iter 39 seed (CMS pages, artist slugs, featured FAQs)
    # ── One-shot data migrations for the intermediary-marketplace model ──
    # 1. Backfill artist_fee on legacy bookings so admin reports normalise.
    legacy = db.bookings.find({"pricing.artist_fee": {"$exists": False}}, {"id": 1, "pricing": 1})
    migrated = 0
    async for b in legacy:
        p = b.get("pricing", {}) or {}
        artist_fee = float(p.get("package_fee", 0) + p.get("addons_total", 0) - p.get("coupon_discount", 0))
        await db.bookings.update_one(
            {"id": b["id"]},
            {"$set": {"pricing.artist_fee": round(max(0, artist_fee), 2)}},
        )
        migrated += 1
    if migrated:
        log.info("Backfilled artist_fee on %d legacy bookings", migrated)

    # 2. Business-model pivot (Iter 36): BookTalent is a lead-generation
    # marketplace only. Drop any legacy wallet / withdrawal collections so
    # the system never references them again.
    try:
        for legacy_coll in ("wallets", "withdrawals"):
            if legacy_coll in await db.list_collection_names():
                await db[legacy_coll].drop()
                log.info("Dropped legacy collection: %s", legacy_coll)
    except Exception as _e:
        log.warning("Legacy wallet/withdrawal cleanup skipped: %s", _e)

    # 3. Iter 45 — spotlight impression dedup index.
    try:
        await db.spotlight_impressions.create_index("key", unique=True)
    except Exception as _e:
        log.warning("Could not create spotlight_impressions index: %s", _e)


@app.on_event("shutdown")
async def shutdown():
    client.close()
