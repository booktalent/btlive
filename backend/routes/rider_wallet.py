"""
Rider Wallet — curated marketplace of hotel / flight / transport partners
that artists can attach to their travel rider (Sprint 4).

Business model: BookTalent negotiates group discounts with partners; when a
customer books a package with travel requirements, they see partner options
inline in Step 4 with the negotiated discount. This becomes a lead-gen /
commission revenue stream on top of the 5% + 18% GST core.

Collections
-----------
rider_vendors { id, type (hotel|flight|transport), name, tagline, city,
                partner_url, contact_email, phone, discount_pct, star_rating,
                image_url, cta_label, is_active, is_featured, created_at }

Endpoints
---------
GET  /rider-wallet/vendors                 public   ?type=hotel&city=Mumbai
GET  /admin/rider-wallet/vendors           admin list all
POST /admin/rider-wallet/vendors           admin create
PATCH /admin/rider-wallet/vendors/{id}     admin update
DELETE /admin/rider-wallet/vendors/{id}    admin delete (hard)
"""
from __future__ import annotations
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel


VendorType = Literal["hotel", "flight", "transport"]


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
        return
    now = utcnow()
    docs = []
    for v in SEED_VENDORS:
        docs.append({"id": new_id(), "created_at": now, "is_active": True, "is_featured": False, **v})
    if docs:
        await db.rider_vendors.insert_many(docs)


def make_router(*, db, get_current_user, admin_only, utcnow, new_id, clean) -> APIRouter:
    r = APIRouter()

    @r.get("/rider-wallet/vendors")
    async def public_list(
        type: Optional[VendorType] = Query(None),
        city: Optional[str] = Query(None),
        limit: int = Query(24, ge=1, le=100),
    ):
        q: dict = {"is_active": True}
        if type:
            q["type"] = type
        if city:
            # Match nationwide (city null) OR exact city match
            q["$or"] = [{"city": None}, {"city": {"$regex": f"^{city}$", "$options": "i"}}]
        docs = await db.rider_vendors.find(q).sort([("is_featured", -1), ("discount_pct", -1)]).limit(limit).to_list(limit)
        return [clean(d) for d in docs]

    @r.get("/admin/rider-wallet/vendors")
    async def admin_list(_: dict = Depends(admin_only)):
        docs = await db.rider_vendors.find({}).sort("created_at", -1).to_list(500)
        return [clean(d) for d in docs]

    @r.post("/admin/rider-wallet/vendors")
    async def admin_create(body: VendorBody, _: dict = Depends(admin_only)):
        doc = {"id": new_id(), "created_at": utcnow(), **body.model_dump()}
        await db.rider_vendors.insert_one(doc)
        return clean(doc)

    @r.patch("/admin/rider-wallet/vendors/{vid}")
    async def admin_update(vid: str, body: dict, _: dict = Depends(admin_only)):
        # Whitelist writable fields to avoid overwriting id / created_at
        allowed = {"type", "name", "tagline", "city", "partner_url", "contact_email",
                   "phone", "discount_pct", "star_rating", "image_url", "cta_label",
                   "is_active", "is_featured"}
        patch = {k: v for k, v in body.items() if k in allowed}
        if not patch:
            raise HTTPException(400, "No writable fields provided")
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
