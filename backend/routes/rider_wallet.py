"""
Rider Wallet — curated marketplace of hotel / flight / transport partners
that artists can attach to their travel rider (Sprint 4).

Business model: BookTalent negotiates group discounts with partners; when a
customer books a package with travel requirements, they see partner options
inline in Step 4 with the negotiated discount. This becomes a lead-gen /
commission revenue stream on top of the 5% + 18% GST core.

Iter 31 add-ons:
  • Public partner directory — SEO-friendly `/partners/{slug}` detail
  • Click tracking + admin leaderboard — data-driven featured slot rotation
"""
from __future__ import annotations
import re
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel


VendorType = Literal["hotel", "flight", "transport"]


def _slugify(text: str) -> str:
    """Deterministic URL-safe slug — lowercase, non-alnum → '-', trim & dedupe."""
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-+", "-", s) or "vendor"


class VendorBody(BaseModel):
    type: VendorType
    name: str
    tagline: str = ""
    city: Optional[str] = None       # None → nationwide
    partner_url: Optional[str] = None
    contact_email: Optional[str] = None
    phone: Optional[str] = None
    discount_pct: float = 0
    star_rating: Optional[float] = None
    image_url: Optional[str] = None
    cta_label: str = "Get Quote"
    is_active: bool = True
    is_featured: bool = False
    description: Optional[str] = None      # long-form description for the public detail page
    seo_keywords: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────
# Seed data — dropped in on first startup if collection is empty
# ─────────────────────────────────────────────────────────────────────
SEED_VENDORS = [
    {"type": "hotel", "name": "Taj Group", "tagline": "5-star luxury across 100+ cities",
     "city": None, "discount_pct": 15, "star_rating": 5, "cta_label": "Request Quote",
     "partner_url": "https://taj.example.com", "is_featured": True,
     "image_url": "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400"},
    {"type": "hotel", "name": "ITC Hotels", "tagline": "Luxurious 5-star Indian hospitality",
     "city": None, "discount_pct": 12, "star_rating": 5, "cta_label": "Request Quote",
     "partner_url": "https://itchotels.example.com",
     "image_url": "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=400"},
    {"type": "hotel", "name": "Lemon Tree Premier", "tagline": "Vibrant 4-star hotels for touring artists",
     "city": None, "discount_pct": 20, "star_rating": 4, "cta_label": "Book with 20% off",
     "partner_url": "https://lemontree.example.com",
     "image_url": "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=400"},
    {"type": "flight", "name": "IndiGo Corporate", "tagline": "India's #1 airline — corporate rates",
     "city": None, "discount_pct": 8, "cta_label": "Get Corporate Fare",
     "partner_url": "https://indigo.example.com", "is_featured": True,
     "image_url": "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400"},
    {"type": "flight", "name": "Vistara Business", "tagline": "Premium cabin fares for artist teams",
     "city": None, "discount_pct": 10, "cta_label": "Request Business Fare",
     "partner_url": "https://vistara.example.com",
     "image_url": "https://images.unsplash.com/photo-1540962351504-03099e0a754b?w=400"},
    {"type": "transport", "name": "BluSmart Premium", "tagline": "All-electric premium chauffeur rides",
     "city": None, "discount_pct": 15, "cta_label": "Reserve Fleet",
     "partner_url": "https://blusmart.example.com", "is_featured": True,
     "image_url": "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=400"},
    {"type": "transport", "name": "Meru Luxe", "tagline": "Airport pickups + venue transfers",
     "city": None, "discount_pct": 12, "cta_label": "Book Transfer",
     "partner_url": "https://meru.example.com",
     "image_url": "https://images.unsplash.com/photo-1502877338535-766e1452684a?w=400"},
]


async def ensure_seed(db, utcnow, new_id):
    count = await db.rider_vendors.count_documents({})
    if count > 0:
        # Backfill missing slugs on existing docs (idempotent one-time migration)
        cur = db.rider_vendors.find({"$or": [{"slug": {"$exists": False}}, {"slug": None}, {"slug": ""}]})
        async for doc in cur:
            slug = _slugify(f"{doc['name']}-{doc.get('city') or doc['type']}")
            await db.rider_vendors.update_one({"id": doc["id"]}, {"$set": {"slug": slug, "click_count": doc.get("click_count", 0)}})
        return
    now = utcnow()
    docs = []
    for v in SEED_VENDORS:
        slug = _slugify(f"{v['name']}-{v.get('city') or v['type']}")
        docs.append({
            "id": new_id(), "slug": slug, "click_count": 0,
            "created_at": now, "is_active": True, "is_featured": False, **v,
        })
    if docs:
        await db.rider_vendors.insert_many(docs)


def make_router(*, db, get_current_user, admin_only, utcnow, new_id, clean) -> APIRouter:
    r = APIRouter()

    @r.get("/rider-wallet/vendors")
    async def public_list(
        type: Optional[VendorType] = Query(None),
        city: Optional[str] = Query(None),
        featured_only: bool = Query(False),
        limit: int = Query(24, ge=1, le=100),
    ):
        q: dict = {"is_active": True}
        if type:
            q["type"] = type
        if city:
            # Match nationwide (city null) OR exact city match
            q["$or"] = [{"city": None}, {"city": {"$regex": f"^{city}$", "$options": "i"}}]
        if featured_only:
            q["is_featured"] = True
        docs = await db.rider_vendors.find(q).sort([("is_featured", -1), ("click_count", -1), ("discount_pct", -1)]).limit(limit).to_list(limit)
        return [clean(d) for d in docs]

    @r.get("/partners/{slug}")
    async def public_partner_detail(slug: str):
        """Public SEO-friendly partner detail — /partners/taj-group."""
        doc = await db.rider_vendors.find_one({"slug": slug, "is_active": True})
        if not doc:
            raise HTTPException(404, "Partner not found")
        # Related partners of the same type (nationwide + same city)
        related_q: dict = {"is_active": True, "type": doc["type"], "id": {"$ne": doc["id"]}}
        related = await db.rider_vendors.find(related_q).sort([("is_featured", -1), ("click_count", -1)]).limit(6).to_list(6)
        return {"vendor": clean(doc), "related": [clean(r) for r in related]}

    @r.post("/rider-wallet/vendors/{vid}/click")
    async def track_click(vid: str):
        """Fire-and-forget click beacon. Increments the vendor's click_count so
        the admin leaderboard can rank by real demand."""
        result = await db.rider_vendors.update_one({"id": vid}, {"$inc": {"click_count": 1}})
        if result.matched_count == 0:
            raise HTTPException(404, "Vendor not found")
        return {"ok": True}

    @r.get("/admin/rider-wallet/leaderboard")
    async def admin_leaderboard(_: dict = Depends(admin_only), limit: int = Query(20, ge=1, le=100)):
        """Data-driven partner leaderboard — highest click_count first."""
        docs = await db.rider_vendors.find({}).sort([("click_count", -1), ("is_featured", -1)]).limit(limit).to_list(limit)
        return [clean(d) for d in docs]

    @r.post("/admin/rider-wallet/rotate-featured")
    async def rotate_featured(_: dict = Depends(admin_only), top_n: int = Query(3, ge=1, le=10)):
        """Auto-feature the top-N vendors of each type by click_count. Un-feature the rest."""
        # Un-feature everything, then re-feature winners
        await db.rider_vendors.update_many({}, {"$set": {"is_featured": False}})
        promoted = []
        for vtype in ("hotel", "flight", "transport"):
            top = await db.rider_vendors.find({"type": vtype, "is_active": True}).sort("click_count", -1).limit(top_n).to_list(top_n)
            for t in top:
                promoted.append(t["id"])
        if promoted:
            await db.rider_vendors.update_many({"id": {"$in": promoted}}, {"$set": {"is_featured": True}})
        return {"ok": True, "featured_count": len(promoted)}

    @r.get("/admin/rider-wallet/vendors")
    async def admin_list(_: dict = Depends(admin_only)):
        docs = await db.rider_vendors.find({}).sort("created_at", -1).to_list(500)
        return [clean(d) for d in docs]

    @r.post("/admin/rider-wallet/vendors")
    async def admin_create(body: VendorBody, _: dict = Depends(admin_only)):
        payload = body.model_dump()
        # Ensure a unique-ish slug per {name, city|type} — retry with -2/-3 if collision.
        base = _slugify(f"{payload['name']}-{payload.get('city') or payload['type']}")
        slug = base
        n = 2
        while await db.rider_vendors.find_one({"slug": slug}):
            slug = f"{base}-{n}"
            n += 1
        doc = {"id": new_id(), "slug": slug, "click_count": 0, "created_at": utcnow(), **payload}
        await db.rider_vendors.insert_one(doc)
        return clean(doc)

    @r.patch("/admin/rider-wallet/vendors/{vid}")
    async def admin_update(vid: str, body: dict, _: dict = Depends(admin_only)):
        # Whitelist writable fields to avoid overwriting id / created_at
        allowed = {"type", "name", "tagline", "city", "partner_url", "contact_email",
                   "phone", "discount_pct", "star_rating", "image_url", "cta_label",
                   "is_active", "is_featured", "description", "seo_keywords"}
        patch = {k: v for k, v in body.items() if k in allowed}
        if not patch:
            raise HTTPException(400, "No writable fields provided")
        # Refresh slug if name or city changed
        if "name" in patch or "city" in patch:
            current = await db.rider_vendors.find_one({"id": vid})
            if current:
                new_name = patch.get("name", current["name"])
                new_city = patch.get("city", current.get("city"))
                base = _slugify(f"{new_name}-{new_city or current['type']}")
                slug = base
                n = 2
                while await db.rider_vendors.find_one({"slug": slug, "id": {"$ne": vid}}):
                    slug = f"{base}-{n}"
                    n += 1
                patch["slug"] = slug
        patch["updated_at"] = utcnow()
        result = await db.rider_vendors.update_one({"id": vid}, {"$set": patch})
        if result.matched_count == 0:
            raise HTTPException(404, "Vendor not found")
        doc = await db.rider_vendors.find_one({"id": vid})
        return clean(doc)

    @r.delete("/admin/rider-wallet/vendors/{vid}")
    async def admin_delete(vid: str, _: dict = Depends(admin_only)):
        result = await db.rider_vendors.delete_one({"id": vid})
        if result.deleted_count == 0:
            raise HTTPException(404, "Vendor not found")
        return {"ok": True}

    return r
