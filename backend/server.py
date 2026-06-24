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
import bcrypt
import jwt
import razorpay
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List, Literal, Any, Dict

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from pdf_service import generate_contract_pdf, generate_invoice_pdf

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
    # customer specific
    company_name: Optional[str] = None


class PackageBody(BaseModel):
    name: str
    description: str = ""
    price: float
    duration: str = ""
    features: List[str] = []
    is_popular: bool = False


class MediaUploadBody(BaseModel):
    """Used for base64 image uploads via JSON for convenience."""
    type: Literal["profile", "cover", "gallery", "video", "reel", "document", "kyc", "review"]
    data_url: str  # data:image/...;base64,XXX
    title: Optional[str] = None
    is_featured: bool = False


class AvailabilityBody(BaseModel):
    date: str  # YYYY-MM-DD
    status: Literal["available", "blocked", "booked"]


class BookingCreate(BaseModel):
    artist_id: str
    package_id: str
    addons: List[str] = []
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
    photos: List[str] = []  # data urls


class ReviewReplyBody(BaseModel):
    reply: str


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
    expires_at: str  # YYYY-MM-DD
    min_order: float = 0
    applies_to: str = "all"  # all/wedding/corporate
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
    aadhaar: Optional[str] = None  # data url
    pan: Optional[str] = None
    bank_proof: Optional[str] = None


class KYCDecideBody(BaseModel):
    artist_id: str
    decision: Literal["approve", "reject"]
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
        "verified": False,
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
# MEDIA — base64 stored in GridFS-like collection
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/media/upload")
async def media_upload(body: MediaUploadBody, user: dict = Depends(get_current_user)):
    # parse data url
    if not body.data_url.startswith("data:"):
        raise HTTPException(400, "Invalid data URL")
    header, b64 = body.data_url.split(",", 1)
    mime = header.split(";")[0].replace("data:", "") or "application/octet-stream"
    raw = base64.b64decode(b64)
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 25MB)")

    mid = new_id()
    doc = {
        "id": mid,
        "user_id": user["id"],
        "type": body.type,
        "mime": mime,
        "size": len(raw),
        "title": body.title,
        "is_featured": body.is_featured,
        "data": b64,  # base64 stored
        "order": 0,
        "created_at": utcnow(),
    }
    await db.media.insert_one(doc)

    # Convenience: if profile/cover, set on artist profile
    if user["role"] == "artist" and body.type in ("profile", "cover"):
        key = "profile_image" if body.type == "profile" else "cover_image"
        await db.artist_profiles.update_one({"user_id": user["id"]}, {"$set": {key: mid}})

    doc.pop("data", None)
    doc.pop("_id", None)
    return doc


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

    # enrich with packages min price & user info
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
    base = package_price + addon_total
    base_after_discount = max(0, base - coupon_discount)
    platform_fee = round(base_after_discount * (PLATFORM_FEE_PCT / 100), 2)
    gst = round((base_after_discount + platform_fee) * (GST_PCT / 100), 2)
    total = round(base_after_discount + platform_fee + gst, 2)
    token = round(total * (TOKEN_PCT / 100), 2)
    balance = round(total - token, 2)
    return {
        "package_fee": package_price,
        "addons_total": addon_total,
        "coupon_discount": coupon_discount,
        "platform_fee": platform_fee,
        "gst": gst,
        "total": total,
        "token_amount": token,
        "balance_due": balance,
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
        raise HTTPException(400, "Selected date is not available")

    addon_total = sum(ADDON_PRICES.get(a, 0) for a in body.addons)

    coupon_discount = 0
    coupon_doc = None
    if body.coupon_code:
        coupon_doc = await db.coupons.find_one({"code": body.coupon_code.upper(), "active": True})
        if coupon_doc:
            base = float(pkg["price"]) + addon_total
            if coupon_doc["discount_type"] == "percent":
                coupon_discount = round(base * float(coupon_doc["discount_value"]) / 100, 2)
            else:
                coupon_discount = float(coupon_doc["discount_value"])

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
    elif body.action == "reject" and (is_artist or is_admin) and doc["status"] in ("pending_artist", "pending_payment"):
        new_status = "rejected"
        # refund token if paid
        if doc.get("amount_paid", 0) > 0:
            await _refund_to_wallet(doc["customer_id"], doc["amount_paid"], f"Refund for booking {doc['ref']}")
    elif body.action == "counter" and is_artist and body.counter_price:
        history_entry["counter_price"] = body.counter_price
        # update pricing
        new_pricing = calc_booking_pricing(float(body.counter_price), doc["pricing"]["addons_total"], doc["pricing"]["coupon_discount"])
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

FINANCIAL TERMS:
  Package Fee     : ₹{booking['pricing']['package_fee']:.2f}
  Add-ons         : ₹{booking['pricing']['addons_total']:.2f}
  Platform Fee    : ₹{booking['pricing']['platform_fee']:.2f}
  GST (18%)       : ₹{booking['pricing']['gst']:.2f}
  Total           : ₹{booking['pricing']['total']:.2f}
  Token Paid      : ₹{booking['pricing']['token_amount']:.2f}
  Balance Due     : ₹{booking['pricing']['balance_due']:.2f}

STANDARD TERMS:
  1. The Artist agrees to perform as described above on the agreed date.
  2. The Client agrees to provide stage, sound, hospitality as per package rider.
  3. Cancellation by Client 15+ days prior: full refund of advance.
  4. Cancellation by Client 7-14 days prior: 50% refund of advance.
  5. Cancellation by Client <7 days: token amount is non-refundable.
  6. Cancellation by Artist: 100% refund + priority rebooking guaranteed.
  7. This contract is auto-generated and governed by BookTalent's Standard Agreement.

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
    artist_share = booking["pricing"]["package_fee"] + booking["pricing"]["addons_total"] - booking["pricing"]["coupon_discount"]
    # 18% commission cut already implicit via platform_fee
    await db.wallets.update_one({"user_id": booking["artist_id"]}, {
        "$inc": {"balance": artist_share, "total_earned": artist_share, "pending": -artist_share},
    })
    await db.transactions.insert_one({
        "id": new_id(), "user_id": booking["artist_id"], "type": "earning", "amount": artist_share,
        "status": "completed", "description": f"Earning from booking {booking['ref']}",
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
    # Escrow: pending on artist wallet
    await db.wallets.update_one({"user_id": booking["artist_id"]}, {"$inc": {"pending": pay["amount"]}})
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
@api.get("/wallet")
async def get_wallet(user: dict = Depends(get_current_user)):
    w = await db.wallets.find_one({"user_id": user["id"]})
    return clean(w) if w else {"balance": 0, "pending": 0, "total_earned": 0, "total_withdrawn": 0}


@api.get("/wallet/transactions")
async def wallet_tx(user: dict = Depends(get_current_user)):
    docs = await db.transactions.find({"user_id": user["id"]}).sort("created_at", -1).to_list(200)
    return [clean(d) for d in docs]


@api.post("/wallet/withdraw")
async def withdraw(body: WithdrawBody, user: dict = Depends(get_current_user)):
    if body.amount <= 0:
        raise HTTPException(400, "Invalid amount")
    w = await db.wallets.find_one({"user_id": user["id"]})
    if not w or w["balance"] < body.amount:
        raise HTTPException(400, "Insufficient balance")
    wid = new_id()
    await db.withdrawals.insert_one({
        "id": wid, "user_id": user["id"], "amount": body.amount,
        "status": "pending", "created_at": utcnow(),
    })
    await db.wallets.update_one({"user_id": user["id"]}, {"$inc": {"balance": -body.amount}})
    await db.transactions.insert_one({
        "id": new_id(), "user_id": user["id"], "type": "withdrawal",
        "amount": -body.amount, "status": "pending",
        "description": "Withdrawal request submitted", "created_at": utcnow(),
    })
    return {"ok": True, "withdrawal_id": wid}


# ─────────────────────────────────────────────────────────────────────────────
# REVIEWS
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/reviews")
async def create_review(body: ReviewBody, user: dict = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": body.booking_id})
    if not booking or booking["customer_id"] != user["id"]:
        raise HTTPException(404, "Booking not found")
    if booking["status"] != "completed":
        raise HTTPException(400, "Can only review completed bookings")
    if await db.reviews.find_one({"booking_id": body.booking_id}):
        raise HTTPException(400, "Already reviewed")

    rid = new_id()
    # store photos as media records
    photo_ids = []
    for du in body.photos[:5]:
        try:
            header, b64 = du.split(",", 1)
            mime = header.split(";")[0].replace("data:", "")
            mid = new_id()
            await db.media.insert_one({
                "id": mid, "user_id": user["id"], "type": "review",
                "mime": mime, "data": b64, "created_at": utcnow(),
            })
            photo_ids.append(mid)
        except Exception:
            continue

    await db.reviews.insert_one({
        "id": rid, "booking_id": body.booking_id, "customer_id": user["id"],
        "customer_name": booking.get("customer_name"),
        "artist_id": booking["artist_id"], "rating": body.rating, "text": body.text,
        "photos": photo_ids, "event_type": booking.get("event_type"),
        "moderated": "approved", "reply": None, "created_at": utcnow(),
    })

    # update aggregate
    all_reviews = await db.reviews.find({"artist_id": booking["artist_id"], "moderated": "approved"}).to_list(10000)
    avg = sum(r["rating"] for r in all_reviews) / len(all_reviews) if all_reviews else 0
    await db.artist_profiles.update_one(
        {"user_id": booking["artist_id"]},
        {"$set": {"rating_avg": round(avg, 2), "review_count": len(all_reviews)}},
    )
    await db.bookings.update_one({"id": body.booking_id}, {"$set": {"status": "reviewed"}})

    return {"ok": True, "review_id": rid}


@api.get("/reviews/artist/{user_id}")
async def reviews_for_artist(user_id: str):
    docs = await db.reviews.find({"artist_id": user_id, "moderated": {"$ne": "rejected"}}).sort("created_at", -1).to_list(200)
    return [clean(d) for d in docs]


@api.post("/reviews/{rid}/reply")
async def reply_review(rid: str, body: ReviewReplyBody, user: dict = Depends(get_current_user)):
    r = await db.reviews.find_one({"id": rid})
    if not r or r["artist_id"] != user["id"]:
        raise HTTPException(404, "Not found")
    await db.reviews.update_one({"id": rid}, {"$set": {"reply": body.reply, "replied_at": utcnow()}})
    return {"ok": True}


@api.post("/reviews/{rid}/report")
async def report_review(rid: str, user: dict = Depends(get_current_user)):
    await db.review_reports.insert_one({
        "id": new_id(), "review_id": rid, "reporter_id": user["id"], "created_at": utcnow(),
    })
    return {"ok": True}


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
# KYC
# ─────────────────────────────────────────────────────────────────────────────
@api.post("/kyc/submit")
async def kyc_submit(body: KYCSubmitBody, user: dict = Depends(get_current_user)):
    docs = {}
    for k, v in body.model_dump(exclude_unset=True).items():
        if not v:
            continue
        if v.startswith("data:"):
            try:
                header, b64 = v.split(",", 1)
                mime = header.split(";")[0].replace("data:", "")
                mid = new_id()
                await db.media.insert_one({"id": mid, "user_id": user["id"], "type": "kyc", "mime": mime, "data": b64, "created_at": utcnow(), "kyc_field": k})
                docs[k] = mid
            except Exception:
                continue
    await db.kyc_submissions.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], "documents": docs, "status": "pending", "submitted_at": utcnow()}},
        upsert=True,
    )
    await db.users.update_one({"id": user["id"]}, {"$set": {"kyc_status": "pending"}})
    if user["role"] == "artist":
        await db.artist_profiles.update_one({"user_id": user["id"]}, {"$set": {"kyc_status": "pending"}})
    return {"ok": True}


@api.get("/kyc/mine")
async def kyc_mine(user: dict = Depends(get_current_user)):
    doc = await db.kyc_submissions.find_one({"user_id": user["id"]})
    return clean(doc) if doc else None


# ─────────────────────────────────────────────────────────────────────────────
# ADMIN
# ─────────────────────────────────────────────────────────────────────────────
@api.get("/admin/stats")
async def admin_stats(_: dict = Depends(admin_only)):
    total_gmv = 0
    async for b in db.bookings.find({"status": {"$in": ["confirmed", "completed", "reviewed", "started", "completed_by_artist"]}}):
        total_gmv += float(b.get("pricing", {}).get("total", 0))
    platform_rev = 0
    async for b in db.bookings.find({"status": {"$in": ["confirmed", "completed", "reviewed", "started", "completed_by_artist"]}}):
        platform_rev += float(b.get("pricing", {}).get("platform_fee", 0))

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
        "gmv": total_gmv,
        "platform_revenue": platform_rev,
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


@api.get("/admin/kyc")
async def admin_kyc(_: dict = Depends(admin_only)):
    docs = await db.kyc_submissions.find({"status": "pending"}).to_list(500)
    out = []
    for d in docs:
        d = clean(d)
        u = await db.users.find_one({"id": d["user_id"]})
        d["user"] = clean(u)
        out.append(d)
    return out


@api.post("/admin/kyc/decide")
async def admin_kyc_decide(body: KYCDecideBody, _: dict = Depends(admin_only)):
    new_status = "approved" if body.decision == "approve" else "rejected"
    await db.kyc_submissions.update_one({"user_id": body.artist_id}, {"$set": {"status": new_status, "decided_at": utcnow(), "reason": body.reason}})
    await db.users.update_one({"id": body.artist_id}, {"$set": {"kyc_status": new_status, "verified": new_status == "approved"}})
    await db.artist_profiles.update_one({"user_id": body.artist_id}, {"$set": {"kyc_status": new_status}})
    await db.notifications.insert_one({
        "id": new_id(), "user_id": body.artist_id, "type": "kyc",
        "title": f"KYC {new_status}", "body": body.reason or "Your KYC has been reviewed",
        "read": False, "created_at": utcnow(), "link": "/dashboard/profile",
    })
    return {"ok": True}


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
@api.post("/admin/coupons")
async def admin_create_coupon(body: CouponBody, _: dict = Depends(admin_only)):
    doc = body.model_dump()
    doc["code"] = doc["code"].upper()
    doc["id"] = new_id()
    doc["created_at"] = utcnow()
    doc["usage_count"] = 0
    await db.coupons.insert_one(doc)
    return clean(doc)


@api.get("/admin/coupons")
async def admin_list_coupons(_: dict = Depends(admin_only)):
    docs = await db.coupons.find().sort("created_at", -1).to_list(500)
    return [clean(d) for d in docs]


@api.delete("/admin/coupons/{cid}")
async def admin_delete_coupon(cid: str, _: dict = Depends(admin_only)):
    await db.coupons.delete_one({"id": cid})
    return {"ok": True}


@api.get("/coupons/validate")
async def coupon_validate(code: str, _: dict = Depends(get_current_user)):
    c = await db.coupons.find_one({"code": code.upper(), "active": True})
    if not c:
        raise HTTPException(404, "Invalid coupon")
    return clean(c)


# BLOGS (CMS)
@api.post("/admin/blogs")
async def admin_create_blog(body: BlogBody, _: dict = Depends(admin_only)):
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = utcnow()
    await db.blogs.insert_one(doc)
    return clean(doc)


@api.get("/blogs")
async def list_blogs(published_only: bool = True):
    q = {"published": True} if published_only else {}
    docs = await db.blogs.find(q).sort("created_at", -1).to_list(100)
    return [clean(d) for d in docs]


@api.get("/blogs/{slug}")
async def get_blog(slug: str):
    doc = await db.blogs.find_one({"slug": slug})
    if not doc:
        raise HTTPException(404, "Not found")
    return clean(doc)


# DISPUTES
@api.post("/disputes")
async def create_dispute(body: DisputeBody, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": body.booking_id})
    if not b or user["id"] not in (b["customer_id"], b["artist_id"]):
        raise HTTPException(403, "Not allowed")
    did = new_id()
    await db.disputes.insert_one({
        "id": did, "booking_id": body.booking_id, "raised_by": user["id"],
        "reason": body.reason, "description": body.description,
        "status": "open", "created_at": utcnow(),
    })
    return {"id": did}


@api.get("/admin/disputes")
async def admin_disputes(_: dict = Depends(admin_only)):
    docs = await db.disputes.find().sort("created_at", -1).to_list(500)
    return [clean(d) for d in docs]


@api.post("/admin/disputes/{did}/resolve")
async def resolve_dispute(did: str, body: DisputeResolveBody, _: dict = Depends(admin_only)):
    d = await db.disputes.find_one({"id": did})
    if not d:
        raise HTTPException(404, "Not found")
    booking = await db.bookings.find_one({"id": d["booking_id"]})
    if body.decision == "refund":
        amount = body.amount or booking.get("amount_paid", 0)
        await _refund_to_wallet(booking["customer_id"], amount, f"Dispute refund {booking['ref']}")
    elif body.decision == "release":
        await _release_payment_to_artist(booking)
    elif body.decision == "partial":
        await _refund_to_wallet(booking["customer_id"], body.amount or 0, f"Partial refund {booking['ref']}")
    await db.disputes.update_one({"id": did}, {"$set": {"status": "resolved", "decision": body.decision, "amount": body.amount, "note": body.note, "resolved_at": utcnow()}})
    return {"ok": True}


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


@app.on_event("shutdown")
async def shutdown():
    client.close()
