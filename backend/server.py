"""
BookTalent — Production-grade Talent Marketplace API
FastAPI + MongoDB + JWT
"""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
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
from routes import wallet as routes_wallet
from routes import coupons as routes_coupons
from routes import blogs as routes_blogs
from routes import disputes as routes_disputes
from routes import kyc as routes_kyc
from routes import uploads as routes_uploads
from routes import addons as routes_addons

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
    status: Literal["available", "blocked", "booked"]


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
    coupon_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_email: Optional[str] = None


class BookingStatusUpdate(BaseModel):
    action: Literal["accept", "reject", "counter", "start", "complete", "approve_completion", "cancel"]
    counter_price: Optional[float] = None
    reason: Optional[str] = None


class PaymentInitBody(BaseModel):
    booking_id: str
    method: Literal["card", "upi", "netbanking", "wallet"]


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


class WithdrawBody(BaseModel):
    amount: float
    bank_id: Optional[str] = None


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

    # Create wallet
    await db.wallets.insert_one({
        "id": new_id(),
        "user_id": uid,
        "balance": 0.0,
        "pending": 0.0,
        "total_earned": 0.0,
        "total_withdrawn": 0.0,
        "created_at": now,
    })

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
    return {"token": token, "user": user_doc}


@api.post("/auth/login")
async def login(body: LoginBody):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid email or password")
    token = make_token(user["id"], user["role"])
    return {"token": token, "user": clean(user)}


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
async def otp_verify(body: OTPBody):
    rec = await db.otps.find_one({"phone": body.phone})
    if not rec or body.otp != "123456":
        raise HTTPException(400, "Invalid OTP")
    # if user exists, log them in. Otherwise return verified flag.
    user = await db.users.find_one({"phone": body.phone})
    if user:
        token = make_token(user["id"], user["role"])
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
    wallet = await db.wallets.find_one({"user_id": user["id"]})
    user["wallet"] = clean(wallet) if wallet else None
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
    query: dict = {}
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
    docs = await db.artist_profiles.find({"$or": [{"is_featured": True}, {"is_boosted": True}]}).limit(limit).to_list(limit)
    if len(docs) < limit:
        extra = await db.artist_profiles.find({"is_featured": {"$ne": True}}).sort("rating_avg", -1).limit(limit - len(docs)).to_list(limit)
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
    await db.availability.update_one(
        {"user_id": user["id"], "date": body.date},
        {"$set": {"id": new_id(), "user_id": user["id"], "date": body.date, "status": body.status}},
        upsert=True,
    )
    return {"ok": True}


@api.get("/availability/mine")
async def my_availability(user: dict = Depends(get_current_user)):
    docs = await db.availability.find({"user_id": user["id"]}).to_list(500)
    return [clean(d) for d in docs]


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
    pkg = await db.packages.find_one({"id": body.package_id, "artist_id": body.artist_id})
    if not pkg:
        raise HTTPException(404, "Package not found")

    artist = await db.users.find_one({"id": body.artist_id})
    if not artist:
        raise HTTPException(404, "Artist not found")

    # check availability
    av = await db.availability.find_one({"user_id": body.artist_id, "date": body.event_date})
    if av and av.get("status") in ("booked", "blocked"):
        # Smart suggestion: find similar artists
        prof = await db.artist_profiles.find_one({"user_id": body.artist_id}) or {}
        suggestions = []
        for q in [
            {"user_id": {"$ne": body.artist_id}, "category": prof.get("category"), "city": prof.get("city")},
            {"user_id": {"$ne": body.artist_id}, "category": prof.get("category")},
            {"user_id": {"$ne": body.artist_id}, "city": prof.get("city")},
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

    bid = new_id()
    ref = booking_ref()
    doc = {
        "id": bid,
        "ref": ref,
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
        "guests": body.guests,
        "language_pref": body.language_pref,
        "notes": body.notes,
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
    return [clean(d) for d in docs]


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
    return {
        "booking": clean(doc),
        "artist": clean(artist),
        "artist_profile": clean(artist_p) if artist_p else None,
        "customer": clean(customer),
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
        # refund token if paid
        if doc.get("amount_paid", 0) > 0:
            await _refund_to_wallet(doc["customer_id"], doc["amount_paid"], f"Refund for booking {doc['ref']}")
    elif body.action == "counter" and is_artist and body.counter_price:
        history_entry["counter_price"] = body.counter_price
        new_pricing = calc_booking_pricing(float(body.counter_price), doc["pricing"]["addons_total"], doc["pricing"]["coupon_discount"])
        await db.bookings.update_one(
            {"id": bid},
            {"$set": {"pricing": new_pricing, "counter_offered_at": utcnow(), "counter_price": body.counter_price}},
        )
        # notify customer
        await db.notifications.insert_one({
            "id": new_id(), "user_id": doc["customer_id"], "type": "counter_offer",
            "title": "Counter offer received",
            "body": f"Artist proposed ₹{body.counter_price} for booking {doc['ref']}",
            "read": False, "created_at": utcnow(), "link": f"/dashboard/bookings/{bid}",
        })
        await db.bookings.update_one({"id": bid}, {"$set": {"pricing": new_pricing}})
    elif body.action == "start" and is_artist and doc["status"] == "confirmed":
        new_status = "started"
    elif body.action == "complete" and is_artist and doc["status"] in ("confirmed", "started"):
        new_status = "completed_by_artist"
    elif body.action == "approve_completion" and (is_customer or is_admin) and doc["status"] in ("completed_by_artist", "completed"):
        new_status = "completed"
        # release funds: token + balance to artist wallet (minus platform fee)
        await _release_payment_to_artist(doc)
    elif body.action == "cancel" and (is_customer or is_admin) and doc["status"] in ("pending_artist", "pending_payment", "confirmed"):
        new_status = "cancelled"
        if doc.get("amount_paid", 0) > 0:
            await _refund_to_wallet(doc["customer_id"], doc["amount_paid"], f"Refund for cancelled booking {doc['ref']}")
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
{_format_travel_reqs(booking.get('travel_requirements') or {})}
FINANCIAL TERMS:
  Artist Performance Fee (paid by Client directly to Artist) : ₹{booking['pricing'].get('artist_fee', booking['pricing'].get('package_fee', 0) + booking['pricing'].get('addons_total', 0)):.2f}

  Platform Service Fee (5% — payable to BookTalent)          : ₹{booking['pricing']['platform_fee']:.2f}
  GST (18% on Platform Fee)                                  : ₹{booking['pricing']['gst']:.2f}
  AMOUNT PAYABLE TO BOOKTALENT                                : ₹{booking['pricing']['total']:.2f}

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


async def _refund_to_wallet(user_id: str, amount: float, note: str):
    await db.wallets.update_one({"user_id": user_id}, {"$inc": {"balance": amount}})
    await db.transactions.insert_one({
        "id": new_id(), "user_id": user_id, "type": "refund", "amount": amount,
        "status": "completed", "description": note, "created_at": utcnow(),
    })


async def _release_payment_to_artist(booking: dict):
    """
    BookTalent does NOT collect the artist performance fee — that is paid
    directly Customer ↔ Artist. This helper still records the equivalent
    amount in the artist's wallet for activity/earnings tracking ONLY.
    No real money moves through this path under the current business model.
    """
    artist_share = booking["pricing"].get("artist_fee",
                                          booking["pricing"].get("package_fee", 0)
                                          + booking["pricing"].get("addons_total", 0)
                                          - booking["pricing"].get("coupon_discount", 0))
    await db.wallets.update_one({"user_id": booking["artist_id"]}, {
        "$inc": {"total_earned": artist_share},
    })
    await db.transactions.insert_one({
        "id": new_id(), "user_id": booking["artist_id"], "type": "direct_settlement",
        "amount": artist_share, "status": "informational",
        "description": f"Direct settlement from customer for booking {booking['ref']} (not processed by BookTalent)",
        "booking_id": booking["id"], "created_at": utcnow(),
    })
    # bump artist stats
    await db.artist_profiles.update_one({"user_id": booking["artist_id"]}, {"$inc": {"events_done": 1}})


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

    # Update booking
    new_amount_paid = booking.get("amount_paid", 0) + pay["amount"]
    await db.bookings.update_one(
        {"id": body.booking_id},
        {"$set": {"payment_status": "token_paid", "amount_paid": new_amount_paid, "status": "pending_artist"},
         "$push": {"history": {"at": utcnow(), "action": "paid_token", "by": user["id"], "amount": pay["amount"], "gateway": pay.get("gateway")}}},
    )
    # Under the intermediary-marketplace model, the customer's payment is the
    # BookTalent Platform Service Fee + GST — NOT money belonging to the artist.
    # We therefore DO NOT add it to the artist's wallet pending balance.
    # (Artist Performance Fee is settled directly Customer ↔ Artist.)
    # Customer ledger
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

    # Credit wallet
    await _refund_to_wallet(pay["user_id"], amount, f"Refund for payment {payment_id}")
    return {"ok": True, "amount": amount}


# ─────────────────────────────────────────────────────────────────────────────
# WALLET
# ─────────────────────────────────────────────────────────────────────────────
# ── Wallet endpoints moved to routes/wallet.py (Iter 13) ─────────────────────


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
async def admin_stats(_: dict = Depends(admin_only)):
    # GMV = artist_fee marketplace volume (informational — money flowing through platform)
    # Platform Revenue = what BookTalent actually collects (platform_fee + gst)
    total_gmv = 0.0          # marketplace volume (artist fees only — not BT revenue)
    platform_rev = 0.0       # what BT invoiced (platform_fee only — net of GST)
    gst_collected = 0.0
    async for b in db.bookings.find({"status": {"$in": ["confirmed", "completed", "reviewed", "started", "completed_by_artist"]}}):
        p = b.get("pricing", {}) or {}
        total_gmv += float(p.get("artist_fee", p.get("package_fee", 0) + p.get("addons_total", 0)))
        platform_rev += float(p.get("platform_fee", 0))
        gst_collected += float(p.get("gst", 0))

    total_bookings = await db.bookings.count_documents({})
    pending_bookings = await db.bookings.count_documents({"status": {"$in": ["pending_artist", "pending_payment"]}})
    today = datetime.now().strftime("%Y-%m-%d")
    bookings_today = await db.bookings.count_documents({"created_at": {"$gte": today}})
    total_users = await db.users.count_documents({})
    total_artists = await db.users.count_documents({"role": "artist"})
    total_customers = await db.users.count_documents({"role": "customer"})
    open_disputes = await db.disputes.count_documents({"status": "open"})
    pending_payouts = await db.withdrawals.count_documents({"status": "pending"})
    pending_kyc = await db.kyc_submissions.count_documents({"status": "pending"})

    # avg rating
    avgs = await db.artist_profiles.find({"rating_avg": {"$gt": 0}}).to_list(1000)
    avg_rating = (sum(a["rating_avg"] for a in avgs) / len(avgs)) if avgs else 0

    # escrow = sum of all wallets pending
    escrow = 0
    async for w in db.wallets.find():
        escrow += float(w.get("pending", 0))

    return {
        "gmv": total_gmv,                       # marketplace artist-fee volume (informational)
        "platform_revenue": platform_rev,       # BookTalent net platform fee earnings
        "gst_collected": round(gst_collected, 2),
        "bookTalent_total_collected": round(platform_rev + gst_collected, 2),
        "total_bookings": total_bookings,
        "pending_bookings": pending_bookings,
        "bookings_today": bookings_today,
        "total_users": total_users,
        "total_artists": total_artists,
        "total_customers": total_customers,
        "open_disputes": open_disputes,
        "pending_payouts": pending_payouts,
        "pending_kyc": pending_kyc,
        "avg_rating": round(avg_rating, 2),
        "escrow": escrow,
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


@api.get("/admin/users")
async def admin_users(role: Optional[str] = None, _: dict = Depends(admin_only)):
    q: dict = {} if not role else {"role": role}
    docs = await db.users.find(q).sort("created_at", -1).to_list(500)
    return [clean(d) for d in docs]


# /admin/kyc and /admin/kyc/decide moved to routes/kyc.py (Iter 13)


@api.post("/admin/artists/{user_id}/feature")
async def admin_feature(user_id: str, _: dict = Depends(admin_only)):
    a = await db.artist_profiles.find_one({"user_id": user_id})
    if not a:
        raise HTTPException(404, "Not found")
    await db.artist_profiles.update_one({"user_id": user_id}, {"$set": {"is_featured": not a.get("is_featured", False)}})
    return {"ok": True}


@api.post("/admin/artists/{user_id}/suspend")
async def admin_suspend(user_id: str, _: dict = Depends(admin_only)):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(404, "Not found")
    suspended = not u.get("suspended", False)
    await db.users.update_one({"id": user_id}, {"$set": {"suspended": suspended}})
    return {"ok": True, "suspended": suspended}


@api.get("/admin/withdrawals")
async def admin_withdrawals(_: dict = Depends(admin_only)):
    docs = await db.withdrawals.find().sort("created_at", -1).to_list(500)
    out = []
    for d in docs:
        d = clean(d)
        u = await db.users.find_one({"id": d["user_id"]})
        d["user"] = clean(u)
        out.append(d)
    return out


@api.post("/admin/withdrawals/{wid}/release")
async def admin_release_withdrawal(wid: str, _: dict = Depends(admin_only)):
    w = await db.withdrawals.find_one({"id": wid})
    if not w:
        raise HTTPException(404, "Not found")
    await db.withdrawals.update_one({"id": wid}, {"$set": {"status": "completed", "released_at": utcnow()}})
    await db.wallets.update_one({"user_id": w["user_id"]}, {"$inc": {"total_withdrawn": w["amount"]}})
    await db.transactions.update_one(
        {"user_id": w["user_id"], "type": "withdrawal", "amount": -w["amount"], "status": "pending"},
        {"$set": {"status": "completed"}},
    )
    return {"ok": True}


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
    artist_user = await db.users.find_one({"id": booking["artist_id"]}) or {}
    artist_profile = await db.artist_profiles.find_one({"user_id": booking["artist_id"]}) or {}
    pdf_bytes = generate_invoice_pdf(booking, {**artist_user, **artist_profile})
    filename = f"invoice_{booking.get('ref', bid[:8])}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# Counter-offer accept / reject by customer
class CounterDecisionBody(BaseModel):
    accept: bool


@api.post("/bookings/{bid}/counter")
async def counter_decision(bid: str, body: CounterDecisionBody, user: dict = Depends(get_current_user)):
    doc = await db.bookings.find_one({"id": bid})
    if not doc or doc["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")
    if not doc.get("counter_price"):
        raise HTTPException(400, "No active counter-offer")
    if body.accept:
        await db.bookings.update_one(
            {"id": bid},
            {"$set": {"counter_accepted_at": utcnow()},
             "$push": {"history": {"at": utcnow(), "action": "counter_accepted", "by": user["id"]}}},
        )
        await db.notifications.insert_one({
            "id": new_id(), "user_id": doc["artist_id"], "type": "counter_accepted",
            "title": "Counter offer accepted",
            "body": f"Customer accepted ₹{doc['counter_price']} for {doc['ref']}",
            "read": False, "created_at": utcnow(),
        })
    else:
        # revert pricing to original
        pkg = await db.packages.find_one({"id": doc["package_id"]})
        if pkg:
            addon_total = sum(ADDON_PRICES.get(a, 0) for a in doc.get("addons", []))
            new_pricing = calc_booking_pricing(float(pkg["price"]), addon_total, doc["pricing"]["coupon_discount"])
            await db.bookings.update_one({"id": bid}, {"$set": {"pricing": new_pricing, "counter_price": None}})
    return {"ok": True}


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
            "role": "admin", "kyc_status": "approved", "verified": True,
            "created_at": utcnow(), "updated_at": utcnow(),
        })
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    # seed demo data only once
    seed_marker = await db.meta.find_one({"_id": "seed_v3"})
    if not seed_marker:
        await _seed_demo()
        await db.meta.insert_one({"_id": "seed_v3", "seeded_at": utcnow()})
    log.info("BookTalent API ready")


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
        await db.wallets.insert_one({
            "id": new_id(), "user_id": uid, "balance": 48250, "pending": 18000,
            "total_earned": 240000, "total_withdrawn": 190000, "created_at": now,
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
        await db.wallets.insert_one({"id": new_id(), "user_id": cid, "balance": 0, "pending": 0, "total_earned": 0, "total_withdrawn": 0, "created_at": utcnow()})

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

# Iter13 — server.py modularisation. Domain routers split out for maintainability.
_common_deps = dict(db=db, utcnow=utcnow, new_id=new_id, clean=clean)
app.include_router(
    routes_reviews.make_router(get_current_user=get_current_user, admin_only=admin_only,
                               notify_dispatch=notify_dispatch, **_common_deps),
    prefix="/api",
)
app.include_router(
    routes_wallet.make_router(get_current_user=get_current_user, **_common_deps),
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
                                refund_to_wallet=_refund_to_wallet,
                                release_payment_to_artist=_release_payment_to_artist,
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


@app.on_event("startup")
async def _iter7_startup():
    await _iter7_router.seed()
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

    # 2. Reset negative artist-wallet pending balances (legacy escrow bug).
    fix_res = await db.wallets.update_many(
        {"pending": {"$lt": 0}},
        {"$set": {"pending": 0}},
    )
    if fix_res.modified_count:
        log.info("Reset %d negative wallet pending balances", fix_res.modified_count)


@app.on_event("shutdown")
async def shutdown():
    client.close()
