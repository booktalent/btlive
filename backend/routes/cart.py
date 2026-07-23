"""
/api/cart — Persistent Multi-Artist Booking Cart (Iter 52).

Behaviour contract (per user spec, Feb 2026):
* Cart survives login/logout, page refresh, browser close (7-day TTL).
* Anonymous cart lives under an `anon_id` (cookie or first request header).
* On first authenticated request the anon cart is merged into the user cart.
* Cart items: {artist_id, package_id?, event_date?, event_city?, addons[],
  price_snapshot} — enough to render Cart page without re-fetching.
* Business rules on pricing (5% platform fee + 18% GST) live in the checkout
  flow, NOT the cart — cart only stores base amounts.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorDatabase


ANON_COOKIE = "bt_cart_anon"
CART_TTL_DAYS = 30  # cart auto-expires after 30 days


class CartItemIn(BaseModel):
    artist_id: str
    package_id: Optional[str] = None
    event_date: Optional[str] = None
    event_city: Optional[str] = None
    event_type: Optional[str] = None
    duration_hours: Optional[float] = 3.0
    addons: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class CartItemOut(CartItemIn):
    id: str
    added_at: str
    # Snapshotted display data so the cart page never needs a second fetch:
    artist_name: Optional[str] = None
    artist_photo: Optional[str] = None
    artist_category: Optional[str] = None
    artist_city: Optional[str] = None
    package_name: Optional[str] = None
    base_price: Optional[float] = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _snapshot_artist(db: AsyncIOMotorDatabase, artist_id: str, package_id: Optional[str]):
    """Fetch minimal display info + resolved base price so the cart is
    self-contained. Never raises — returns Nones on lookup miss so the caller
    can still queue the item and let the checkout flow re-validate.

    Package pricing:
      * If `package_id` is given, use that package's price.
      * Else use the cheapest package for the artist.
      * Else fall back to artist_profile.base_price / starting_price / 0.
    """
    art = await db.artist_profiles.find_one({"id": artist_id}) or await db.artist_profiles.find_one({"user_id": artist_id})
    if not art:
        return {}
    photo = None
    if art.get("hero_media_id"):
        photo = art["hero_media_id"]
    elif art.get("profile_image"):
        photo = art["profile_image"]
    elif art.get("photos"):
        photo = art["photos"][0]

    # Package pricing lookup (packages live in a separate collection)
    pkg_name: Optional[str] = None
    base_price: float = 0.0
    art_uid = art.get("user_id") or art.get("id")
    if package_id:
        pkg = await db.packages.find_one({"id": package_id, "artist_id": art_uid})
        if pkg:
            pkg_name = pkg.get("name")
            base_price = float(pkg.get("price") or 0)
    if base_price == 0:
        # Take the cheapest package as the default "from ₹X" price.
        cheapest = None
        async for p in db.packages.find({"artist_id": art_uid}).sort("price", 1).limit(1):
            cheapest = p
        if cheapest:
            base_price = float(cheapest.get("price") or 0)
            if not pkg_name:
                pkg_name = cheapest.get("name")
    if base_price == 0:
        # Legacy embedded price fields on the profile.
        base_price = float(art.get("base_price") or art.get("starting_price") or 0)

    return {
        "artist_name": art.get("stage_name") or art.get("name"),
        "artist_photo": photo,
        "artist_category": art.get("primary_category") or art.get("category"),
        "artist_city": art.get("city"),
        "package_name": pkg_name,
        "base_price": base_price,
    }


def _serialise_item(it: dict) -> dict:
    """Drop MongoDB _id, coerce datetimes to iso."""
    out = {k: v for k, v in it.items() if k != "_id"}
    if isinstance(out.get("added_at"), datetime):
        out["added_at"] = out["added_at"].astimezone(timezone.utc).isoformat()
    return out


async def _resolve_cart_key(request: Request, get_current_user_fn):
    """Return either ('user', user_id) or ('anon', anon_id).

    We prefer the authenticated user identity when present; otherwise we fall
    back to a stable anon cookie so the same browser gets the same cart even
    across tabs. `get_current_user_fn` may raise 401 → treat as anonymous.
    """
    try:
        u = await get_current_user_fn(request)
    except Exception:
        u = None
    if u and u.get("id"):
        return "user", u["id"]
    anon = request.cookies.get(ANON_COOKIE)
    if not anon:
        anon = uuid.uuid4().hex
    return "anon", anon


def make_cart_router(db: AsyncIOMotorDatabase, get_current_user_fn):
    router = APIRouter(prefix="/cart", tags=["cart"])

    async def _get_or_create(kind: str, key: str):
        q = {"user_id": key} if kind == "user" else {"anon_id": key}
        doc = await db.carts.find_one(q)
        if not doc:
            doc = {
                "id": uuid.uuid4().hex,
                "user_id": key if kind == "user" else None,
                "anon_id": key if kind == "anon" else None,
                "items": [],
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            }
            await db.carts.insert_one(doc)
        return doc

    async def _merge_anon_into_user(anon_id: str, user_id: str):
        """When a user logs in with items in the anon cart, splice them into
        the user's cart (deduping by artist_id + event_date)."""
        if not anon_id:
            return
        anon = await db.carts.find_one({"anon_id": anon_id})
        if not anon or not anon.get("items"):
            if anon:
                await db.carts.delete_one({"_id": anon["_id"]})
            return
        user_cart = await _get_or_create("user", user_id)
        existing_keys = {(x.get("artist_id"), x.get("event_date")) for x in user_cart["items"]}
        new_items = [it for it in anon["items"] if (it.get("artist_id"), it.get("event_date")) not in existing_keys]
        if new_items:
            await db.carts.update_one(
                {"_id": user_cart["_id"]},
                {"$push": {"items": {"$each": new_items}}, "$set": {"updated_at": _now_iso()}},
            )
        await db.carts.delete_one({"_id": anon["_id"]})

    def _write_anon_cookie(resp: Response, anon_id: str):
        secure = os.environ.get("COOKIE_SECURE", "1") == "1"
        resp.set_cookie(
            ANON_COOKIE, anon_id,
            max_age=CART_TTL_DAYS * 86400,
            httponly=False,  # cart id is not a secret; JS can read for optimistic UI
            secure=secure,
            samesite="lax",
            path="/",
        )

    @router.get("")
    async def get_cart(request: Request, response: Response):
        kind, key = await _resolve_cart_key(request, get_current_user_fn)
        # If the user just logged in and had an anon cart, merge it now.
        if kind == "user":
            anon_id = request.cookies.get(ANON_COOKIE)
            if anon_id:
                await _merge_anon_into_user(anon_id, key)
                response.delete_cookie(ANON_COOKIE, path="/")
        else:
            _write_anon_cookie(response, key)
        cart = await _get_or_create(kind, key)
        items = [_serialise_item(i) for i in cart.get("items", [])]
        return {"id": cart["id"], "items": items, "updated_at": cart.get("updated_at")}

    @router.post("/items")
    async def add_item(body: CartItemIn, request: Request, response: Response):
        kind, key = await _resolve_cart_key(request, get_current_user_fn)
        cart = await _get_or_create(kind, key)
        # Duplicate guard — same artist + same date = idempotent no-op.
        for it in cart.get("items", []):
            if it.get("artist_id") == body.artist_id and (it.get("event_date") or None) == (body.event_date or None):
                if kind == "anon":
                    _write_anon_cookie(response, key)
                return {"status": "duplicate", "item_id": it["id"], "cart_size": len(cart["items"])}
        snap = await _snapshot_artist(db, body.artist_id, body.package_id)
        item = {
            "id": uuid.uuid4().hex,
            **body.model_dump(),
            **snap,
            "added_at": _now_iso(),
        }
        await db.carts.update_one(
            {"_id": cart["_id"]},
            {"$push": {"items": item}, "$set": {"updated_at": _now_iso()}},
        )
        if kind == "anon":
            _write_anon_cookie(response, key)
        return {"status": "added", "item_id": item["id"], "cart_size": len(cart.get("items", [])) + 1}

    @router.delete("/items/{item_id}")
    async def remove_item(item_id: str, request: Request):
        kind, key = await _resolve_cart_key(request, get_current_user_fn)
        cart = await _get_or_create(kind, key)
        new_items = [it for it in cart.get("items", []) if it.get("id") != item_id]
        await db.carts.update_one(
            {"_id": cart["_id"]},
            {"$set": {"items": new_items, "updated_at": _now_iso()}},
        )
        return {"status": "ok", "cart_size": len(new_items)}

    @router.post("/clear")
    async def clear_cart(request: Request):
        kind, key = await _resolve_cart_key(request, get_current_user_fn)
        cart = await _get_or_create(kind, key)
        await db.carts.update_one({"_id": cart["_id"]}, {"$set": {"items": [], "updated_at": _now_iso()}})
        return {"status": "ok"}

    @router.patch("/items/{item_id}")
    async def patch_item(item_id: str, body: dict, request: Request):
        """Partial update — used to attach package_id / date / add-ons after
        the user picks them on the cart page."""
        kind, key = await _resolve_cart_key(request, get_current_user_fn)
        cart = await _get_or_create(kind, key)
        items = cart.get("items", [])
        allowed = {"package_id", "event_date", "event_city", "event_type", "duration_hours", "addons", "notes"}
        for it in items:
            if it.get("id") == item_id:
                for k, v in body.items():
                    if k in allowed:
                        it[k] = v
                # Re-snapshot base price if package changed
                if "package_id" in body:
                    snap = await _snapshot_artist(db, it["artist_id"], it.get("package_id"))
                    it.update({k: v for k, v in snap.items() if v is not None})
                break
        await db.carts.update_one({"_id": cart["_id"]}, {"$set": {"items": items, "updated_at": _now_iso()}})
        return {"status": "ok"}

    return router
