"""
Sprint 5 — Premium Subscription Plans (Free / Silver / Gold / Platinum / Elite).

An artist's active plan drives:
  • search-ranking boost (higher tier → higher `plan_rank`)
  • badge on artist cards ("💎 GOLD", "👑 ELITE")
  • per-tier feature caps (media, add-ons, response-time SLA, boost multiplier)
  • eligibility for Elite-only homepage rail

Plans are seeded on module import; artists subscribe via a mock payment (until
Razorpay recurring is wired). Downgrade to Free is free & immediate.

Endpoints:
  GET  /subscriptions/plans                  — public catalog
  GET  /subscriptions/me                     — current artist subscription
  POST /subscriptions/subscribe              — start / upgrade (mock payment)
  POST /subscriptions/cancel                 — cancel (falls back to Free at period end)
  GET  /admin/subscriptions                  — admin list
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


# ─────────────────────────────────────────────────────────────────────────────
# Plan catalog — single source of truth for pricing + feature gates.
# ─────────────────────────────────────────────────────────────────────────────
PLANS = {
    "free": {
        "code": "free", "name": "Free", "price_monthly": 0, "price_yearly": 0,
        "badge": None, "rank": 0, "featured": False,
        "features": {
            "max_media": 6, "max_addons": 3, "priority_support": False,
            "verified_badge": False, "boost_multiplier": 1.0,
            "response_sla_hours": 48, "elite_rail": False,
            "commission_discount_pct": 0,
        },
    },
    "silver": {
        "code": "silver", "name": "Silver", "price_monthly": 499, "price_yearly": 4990,
        "badge": "SILVER", "rank": 1, "featured": False,
        "features": {
            "max_media": 15, "max_addons": 6, "priority_support": False,
            "verified_badge": True, "boost_multiplier": 1.2,
            "response_sla_hours": 24, "elite_rail": False,
            "commission_discount_pct": 0,
        },
    },
    "gold": {
        "code": "gold", "name": "Gold", "price_monthly": 999, "price_yearly": 9990,
        "badge": "GOLD", "rank": 2, "featured": True,
        "features": {
            "max_media": 40, "max_addons": 12, "priority_support": True,
            "verified_badge": True, "boost_multiplier": 1.5,
            "response_sla_hours": 12, "elite_rail": False,
            "commission_discount_pct": 10,
        },
    },
    "platinum": {
        "code": "platinum", "name": "Platinum", "price_monthly": 2499, "price_yearly": 24990,
        "badge": "PLATINUM", "rank": 3, "featured": True,
        "features": {
            "max_media": 100, "max_addons": 25, "priority_support": True,
            "verified_badge": True, "boost_multiplier": 2.0,
            "response_sla_hours": 6, "elite_rail": False,
            "commission_discount_pct": 20,
        },
    },
    "elite": {
        "code": "elite", "name": "Elite", "price_monthly": 4999, "price_yearly": 49990,
        "badge": "ELITE", "rank": 4, "featured": True,
        "features": {
            "max_media": 500, "max_addons": 100, "priority_support": True,
            "verified_badge": True, "boost_multiplier": 3.0,
            "response_sla_hours": 2, "elite_rail": True,
            "commission_discount_pct": 30,
        },
    },
}


class SubscribeBody(BaseModel):
    plan: Literal["free", "silver", "gold", "platinum", "elite"]
    billing_cycle: Literal["monthly", "yearly"] = "monthly"
    payment_method: str = "mock"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _plan_from_doc(doc: Optional[dict]) -> dict:
    """Resolve the artist's currently active plan document to a full PLAN dict."""
    if not doc or doc.get("status") != "active":
        return PLANS["free"]
    # expired?
    try:
        exp = doc.get("expires_at")
        if exp and datetime.fromisoformat(exp.replace("Z", "+00:00")) < _now():
            return PLANS["free"]
    except Exception:
        pass
    return PLANS.get(doc.get("plan", "free"), PLANS["free"])


async def resolve_plan(db, user_id: str) -> dict:
    """Public helper — used by search/homepage to grade an artist's tier."""
    doc = await db.artist_subscriptions.find_one({"artist_id": user_id, "status": "active"})
    return _plan_from_doc(doc)


def make_router(*, db, get_current_user: Callable, admin_only: Callable, utcnow, new_id, clean) -> APIRouter:
    r = APIRouter()

    @r.get("/subscriptions/plans")
    async def list_plans():
        return list(PLANS.values())

    @r.get("/subscriptions/me")
    async def my_subscription(user: dict = Depends(get_current_user)):
        doc = await db.artist_subscriptions.find_one({"artist_id": user["id"], "status": "active"})
        plan = _plan_from_doc(doc)
        return {"subscription": clean(doc) if doc else None, "plan": plan}

    @r.post("/subscriptions/subscribe")
    async def subscribe(body: SubscribeBody, user: dict = Depends(get_current_user)):
        if user["role"] not in ("artist", "agency"):
            raise HTTPException(403, "Only artists / agencies can subscribe")
        plan = PLANS.get(body.plan)
        if not plan:
            raise HTTPException(400, "Invalid plan")

        # Cancel any existing active subscription (mock: immediate upgrade)
        await db.artist_subscriptions.update_many(
            {"artist_id": user["id"], "status": "active"},
            {"$set": {"status": "cancelled", "cancelled_at": utcnow()}},
        )

        # For Free plan just mark cancellation and return
        if body.plan == "free":
            # bounce cached premium_badge back to False
            await db.artist_profiles.update_one(
                {"user_id": user["id"]},
                {"$set": {"premium_badge": False, "plan_code": "free", "plan_rank": 0}},
            )
            return {"ok": True, "plan": plan, "downgraded": True}

        price = plan["price_yearly"] if body.billing_cycle == "yearly" else plan["price_monthly"]
        days = 365 if body.billing_cycle == "yearly" else 30
        expires = (_now() + timedelta(days=days)).isoformat()

        sub = {
            "id": new_id(),
            "artist_id": user["id"],
            "plan": body.plan,
            "billing_cycle": body.billing_cycle,
            "price": price,
            "status": "active",
            "payment_method": body.payment_method,
            "started_at": utcnow(),
            "expires_at": expires,
            "auto_renew": True,
        }
        await db.artist_subscriptions.insert_one(sub)

        # Update the cached profile denorm so search + card renders in one query
        await db.artist_profiles.update_one(
            {"user_id": user["id"]},
            {"$set": {
                "premium_badge": plan["rank"] >= 2,
                "plan_code": plan["code"],
                "plan_rank": plan["rank"],
            }},
        )

        # in-app notification
        await db.notifications.insert_one({
            "id": new_id(), "user_id": user["id"], "type": "subscription",
            "title": f"Welcome to {plan['name']}!",
            "body": f"Your {plan['name']} plan is active until {expires[:10]}.",
            "read": False, "created_at": utcnow(),
        })

        return {"ok": True, "subscription": clean(sub), "plan": plan}

    @r.post("/subscriptions/cancel")
    async def cancel(user: dict = Depends(get_current_user)):
        doc = await db.artist_subscriptions.find_one({"artist_id": user["id"], "status": "active"})
        if not doc:
            raise HTTPException(404, "No active subscription")
        await db.artist_subscriptions.update_one(
            {"id": doc["id"]},
            {"$set": {"status": "cancelled", "auto_renew": False, "cancelled_at": utcnow()}},
        )
        # Do NOT downgrade cached profile yet — customer keeps benefits until
        # expires_at. A daily cron would flip premium_badge=False; here we
        # rely on `resolve_plan` runtime expiry check.
        return {"ok": True, "expires_at": doc.get("expires_at")}

    @r.get("/admin/subscriptions")
    async def admin_list(_: dict = Depends(admin_only)):
        docs = await db.artist_subscriptions.find({}).sort("started_at", -1).to_list(500)
        return [clean(d) for d in docs]

    return r
