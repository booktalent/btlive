"""
Agency ↔ Artist roster — Iter 63 additions.

The full invite / accept / decline / release / commission flow already
existed in `iter9_routes.py` on the `agency_roster` collection. This
module adds only what was missing per the user's spec:

  GET  /api/agency/referral                (agency) stable referral URL
  POST /api/auth/roster/consume-ref        (public artist) auto-join by ref
  GET  /api/roster/my-agency               (artist) who currently manages me

Business rules (per user):
  - Referral link auto-joins on signup — no accept step.
  - Artist can't leave; only agency can release (already enforced by
    /agency/remove which flips status to 'removed').
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class ConsumeRefBody(BaseModel):
    referral_code: str


def make_roster_router(db: AsyncIOMotorDatabase, get_current_user):
    r = APIRouter(tags=["agency-roster"])

    @r.get("/agency/referral")
    async def get_referral_link(user: dict = Depends(get_current_user)):
        if user.get("role") not in ("agency", "admin"):
            raise HTTPException(403, "Agency access required")
        code = user["id"].replace("-", "")[:12].upper()
        await db.agency_referral_codes.update_one(
            {"code": code},
            {"$set": {"code": code, "agency_id": user["id"], "updated_at": _now()},
             "$setOnInsert": {"created_at": _now()}},
            upsert=True,
        )
        base = os.environ.get("FRONTEND_URL", "").rstrip("/")
        return {
            "code": code,
            "link": f"{base}/signup?role=artist&ref={code}",
            "note": "Artists who sign up via this link auto-join your roster (no accept step).",
        }

    @r.get("/roster/my-agency")
    async def my_agency(user: dict = Depends(get_current_user)):
        if user.get("role") != "artist":
            raise HTTPException(403, "Artist only")
        rel = await db.agency_roster.find_one(
            {"artist_id": user["id"], "status": "active"}, {"_id": 0},
        )
        if not rel:
            return {"active": False}
        u = await db.users.find_one(
            {"id": rel["agency_id"]},
            {"_id": 0, "email": 1, "first_name": 1, "last_name": 1, "company_name": 1},
        )
        return {
            "active": True,
            "agency": u or {},
            "commission_pct": rel.get("commission_pct", 15),
            "since": rel.get("decided_at") or rel.get("created_at"),
        }

    @r.post("/auth/roster/consume-ref")
    async def consume_ref(body: ConsumeRefBody, user: dict = Depends(get_current_user)):
        """Called right after signup when a ?ref=CODE was present.
        Auto-attaches the artist to the referring agency with status='active'."""
        if user.get("role") != "artist":
            raise HTTPException(403, "Artist only")
        code = (body.referral_code or "").strip().upper()
        if not code:
            raise HTTPException(400, "referral_code required")
        row = await db.agency_referral_codes.find_one({"code": code})
        if not row:
            raise HTTPException(404, "Invalid referral code")
        agency_id = row["agency_id"]
        # If artist is already managed anywhere, don't override.
        existing = await db.agency_roster.find_one({
            "artist_id": user["id"], "status": {"$in": ["pending", "active"]},
        })
        if existing:
            return {"ok": False, "reason": "already_linked", "status": existing["status"]}
        await db.agency_roster.insert_one({
            "id": _new_id(),
            "agency_id": agency_id,
            "artist_id": user["id"],
            "artist_email": user["email"],
            "commission_pct": 15,
            "status": "active",
            "source": "referral_link",
            "referral_code": code,
            "created_at": _now(),
            "decided_at": _now(),
        })
        await db.notifications.insert_one({
            "id": _new_id(), "user_id": agency_id, "type": "agency_referral_joined",
            "title": "New artist joined via your referral",
            "body": f"{user.get('first_name') or 'An artist'} signed up using your referral link.",
            "link": "/agency/artists", "read": False, "created_at": _now(),
        })
        return {"ok": True, "agency_id": agency_id}

    return r
