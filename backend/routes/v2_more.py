"""
Iter 85 — Phase 4-7 completions.

Adds:
  * At-Risk Booking auto-detection endpoint         (Sec 55)
  * Agency Financial View                            (Sec 45-48)
  * Admin Payout Queue (pending settlements)         (Sec 40-41)
  * WhatsApp channel abstraction                     (Sec 23, 51)

The WhatsApp abstraction is provider-agnostic — set
``WHATSAPP_PROVIDER`` in .env to ``gupshup`` or ``meta`` and configure
the matching credentials. Until then, sends are logged & persisted so
the rest of the platform can already fire WhatsApp events safely.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

log = logging.getLogger("v2.more")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════
# WhatsApp channel abstraction
# ═══════════════════════════════════════════════════════════════════════
WHATSAPP_PROVIDER = (os.environ.get("WHATSAPP_PROVIDER") or "").strip().lower()  # "" | "gupshup" | "meta"


async def send_whatsapp(db: AsyncIOMotorDatabase, *, to: str, template: str,
                        params: Optional[Dict[str, Any]] = None,
                        body: Optional[str] = None) -> Dict[str, Any]:
    """Dispatch a WhatsApp message. Persists every attempt to
    ``whatsapp_logs`` with the provider response so we have a proper
    audit trail.

    Providers:
      * gupshup — https://gupshup.io. Requires ``GUPSHUP_API_KEY``,
        ``GUPSHUP_SOURCE`` (your registered WhatsApp number), and
        ``GUPSHUP_APP_NAME``.
      * meta    — Meta Cloud API. Requires ``META_WA_TOKEN`` and
        ``META_WA_PHONE_ID``.

    When no provider is configured we still store the payload so ops can
    manually reach out and downstream code doesn't need to branch.
    """
    payload = {"to": to, "template": template, "params": params or {}, "body": body or ""}
    result: Dict[str, Any] = {"sent": False, "provider": WHATSAPP_PROVIDER or "mock"}
    try:
        if WHATSAPP_PROVIDER == "gupshup":
            api_key = os.environ.get("GUPSHUP_API_KEY", "").strip()
            source = os.environ.get("GUPSHUP_SOURCE", "").strip()
            if not (api_key and source):
                raise RuntimeError("Gupshup misconfigured — set GUPSHUP_API_KEY/GUPSHUP_SOURCE")
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(
                    "https://api.gupshup.io/wa/api/v1/msg",
                    headers={"apikey": api_key,
                              "Content-Type": "application/x-www-form-urlencoded"},
                    data={"channel": "whatsapp", "source": source,
                           "destination": to,
                           "message": body or f"Template: {template}"},
                )
            result["status"] = r.status_code
            result["response"] = r.text[:500]
            result["sent"] = r.status_code < 400
        elif WHATSAPP_PROVIDER == "meta":
            token = os.environ.get("META_WA_TOKEN", "").strip()
            phone_id = os.environ.get("META_WA_PHONE_ID", "").strip()
            if not (token and phone_id):
                raise RuntimeError("Meta Cloud API misconfigured — set META_WA_TOKEN/META_WA_PHONE_ID")
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(
                    f"https://graph.facebook.com/v20.0/{phone_id}/messages",
                    headers={"Authorization": f"Bearer {token}",
                              "Content-Type": "application/json"},
                    json={"messaging_product": "whatsapp", "to": to,
                           "type": "text", "text": {"body": body or f"Template: {template}"}},
                )
            result["status"] = r.status_code
            result["response"] = r.text[:500]
            result["sent"] = r.status_code < 400
        else:
            log.info("[MOCK WhatsApp] to=%s template=%s body=%s", to, template, body)
            result["sent"] = True
            result["mock"] = True
    except Exception as e:  # noqa: BLE001
        log.warning("WhatsApp send failed: %s", e)
        result["error"] = str(e)

    # Persist ATTEMPT (success or fail) — never raises
    try:
        await db.whatsapp_logs.insert_one({
            "id": str(uuid.uuid4()),
            "to": to, "template": template, "params": params or {},
            "body": body or "", **result, "at": utcnow(),
        })
    except Exception:
        pass
    return result


# ═══════════════════════════════════════════════════════════════════════
# ROUTER
# ═══════════════════════════════════════════════════════════════════════
def make_v2_more_router(db: AsyncIOMotorDatabase, get_current_user, require_admin) -> APIRouter:
    r = APIRouter()

    # ── At-Risk Booking Dashboard (Sec 55) ─────────────────────────
    @r.get("/admin/at-risk-bookings")
    async def at_risk_bookings(_admin: dict = Depends(require_admin)):
        """Auto-flag bookings that need immediate attention. Returns a
        categorised map so the dashboard can render each risk-bucket."""
        now = datetime.now(timezone.utc)
        soon = (now + timedelta(days=3)).date().isoformat()
        today = now.date().isoformat()

        # 1. Event within 3 days + payment pending
        event_soon_unpaid = await db.bookings.find({
            "event_date": {"$lte": soon, "$gte": today},
            "status": {"$in": ["confirmed", "pending_artist"]},
            "$or": [
                {"payment_status": {"$in": [None, "pending", "partially_paid"]}},
                {"payment_status": {"$exists": False}},
            ],
        }, {"_id": 0}).sort("event_date", 1).to_list(50)

        # 2. Artist payout pending on completed events
        payout_pending = await db.bookings.find({
            "status": "completed",
            "$or": [
                {"artist_payout_status": {"$in": [None, "pending"]}},
                {"artist_payout_status": {"$exists": False}},
            ],
        }, {"_id": 0}).sort("event_date", -1).to_list(50)

        # 3. Customer payment overdue
        schedules_overdue = await db.payment_schedules.find({
            "milestones.status": "overdue",
        }, {"_id": 0}).sort("updated_at", -1).to_list(50)

        # 4. Manager not assigned (leads that got old without a manager)
        cutoff = (now - timedelta(hours=24)).isoformat()
        leads_unassigned = await db.leads.find({
            "assigned_manager_id": {"$in": [None, ""]},
            "created_at": {"$lte": cutoff},
            "stage": {"$nin": ["closed", "lost_cancelled"]},
        }, {"_id": 0}).sort("created_at", -1).to_list(50)

        # 5. KYC incomplete artists (any state pre-live for > 7 days)
        seven = (now - timedelta(days=7)).isoformat()
        kyc_stuck = await db.artist_profiles.find({
            "kyc_status": {"$in": ["kyc_pending", "kyc_under_review", "kyc_changes_required"]},
            "kyc_updated_at": {"$lte": seven},
        }, {"_id": 0, "user_id": 1, "stage_name": 1, "kyc_status": 1, "kyc_updated_at": 1}
        ).sort("kyc_updated_at", 1).to_list(50)

        return {
            "event_soon_unpaid": event_soon_unpaid,
            "payout_pending": payout_pending,
            "schedules_overdue": schedules_overdue,
            "leads_unassigned": leads_unassigned,
            "kyc_stuck": kyc_stuck,
            "total": (len(event_soon_unpaid) + len(payout_pending) + len(schedules_overdue)
                       + len(leads_unassigned) + len(kyc_stuck)),
        }

    # ── Agency Financial View (Sec 45-48) ─────────────────────────
    @r.get("/agency/financial-view")
    async def agency_financial_view(user: dict = Depends(get_current_user)):
        if user.get("role") != "agency":
            raise HTTPException(403, "Agency only")
        aid = user["id"]

        # Roster artists that belong to this agency
        roster = await db.agency_roster.find(
            {"agency_id": aid, "status": "active"}, {"_id": 0, "artist_id": 1},
        ).to_list(500)
        artist_ids = [row["artist_id"] for row in roster]
        if not artist_ids:
            return {"artists": [], "bookings": [], "totals": {}}

        # Bookings for those artists
        bookings = await db.bookings.find(
            {"artist_id": {"$in": artist_ids}}, {"_id": 0},
        ).sort("created_at", -1).to_list(500)

        # Aggregate payment + payout status per booking
        for b in bookings:
            sched = await db.payment_schedules.find_one(
                {"booking_id": b["id"]},
                {"_id": 0, "amount_received": 1, "total": 1, "milestones.status": 1},
            )
            b["customer_payment_received"] = float(sched.get("amount_received", 0)) if sched else 0
            b["customer_payment_total"] = float(sched.get("total", 0) or b.get("pricing", {}).get("total", 0))
            b["customer_payment_status"] = (
                "fully_paid" if b["customer_payment_received"] >= b["customer_payment_total"] > 0
                else ("partially_paid" if b["customer_payment_received"] > 0
                      else "pending")
            )
            b["artist_payout_status"] = b.get("artist_payout_status", "pending")

        totals = {
            "customer_received": sum(b["customer_payment_received"] for b in bookings),
            "customer_total":    sum(b["customer_payment_total"] for b in bookings),
            "payout_paid_count": sum(1 for b in bookings if b.get("artist_payout_status") == "paid"),
            "payout_pending_count": sum(1 for b in bookings if b.get("artist_payout_status") in (None, "pending")),
        }
        return {"artists": artist_ids, "bookings": bookings, "totals": totals}

    # ── Admin Payout Console (Sec 40-41) ──────────────────────────
    @r.get("/admin/payouts/pending")
    async def payouts_pending(_admin: dict = Depends(require_admin)):
        """Bookings that are completed / event-past but payout not marked."""
        cursor = db.bookings.find(
            {"status": {"$in": ["completed", "confirmed"]},
             "$or": [
                 {"artist_payout_status": {"$in": [None, "pending"]}},
                 {"artist_payout_status": {"$exists": False}},
             ]},
            {"_id": 0},
        ).sort("event_date", -1).limit(200)
        rows = [b async for b in cursor]
        return {"items": rows, "count": len(rows)}

    return r
