"""
Easebuzz Payment Gateway routes.

Design notes
------------
- All Key / Salt / Base URL / environment flags live in the
  `payment_gateway_settings` Mongo collection and are edited from the Admin
  Panel. Nothing is read from source code.
- One payment doc in `payments` can hold N booking_ids (batch checkout).
- All raw request/response bodies (initiate, callback, retrieve) go into
  `payment_logs` for debugging.
- Success/failure callback is `application/x-www-form-urlencoded` per
  Easebuzz spec. We verify the response hash, then re-verify via the
  retrieve API before flipping any booking to `token_paid`.
- Callbacks are idempotent — a duplicate POST for a txnid that is already
  marked `completed` simply returns 200 without side-effects.
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel, Field

from easebuzz_service import (
    build_initiate_hash, build_response_hash, build_retrieve_hash,
    initiate_link, retrieve_txn, normalise_amount,
    default_settings_document,
)

log = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# Public settings model — only non-secret fields exposed to non-admin users.
# ────────────────────────────────────────────────────────────────────────────
class EasebuzzEnvBlock(BaseModel):
    key: str = ""
    salt: str = ""
    base_url: str = ""


class PaymentSettingsUpdate(BaseModel):
    """Payload accepted by PUT /admin/payment-settings."""
    enabled: Optional[bool] = None
    environment: Optional[str] = Field(default=None, pattern="^(sandbox|live)$")
    sandbox: Optional[EasebuzzEnvBlock] = None
    live: Optional[EasebuzzEnvBlock] = None
    success_url: Optional[str] = None
    failure_url: Optional[str] = None
    webhook_url: Optional[str] = None


class EasebuzzInitBody(BaseModel):
    booking_ids: List[str]
    method: Optional[str] = "upi"     # informational only, Easebuzz hosted page chooses


class SubInitBody(BaseModel):
    plan: str
    billing_cycle: str = "monthly"


class BoostInitBody(BaseModel):
    package_id: str


# ────────────────────────────────────────────────────────────────────────────
# Helpers — settings + logging + booking finalisation
# ────────────────────────────────────────────────────────────────────────────
async def _load_settings(db) -> Dict[str, Any]:
    doc = await db.payment_gateway_settings.find_one({"_id": "active"})
    if not doc:
        doc = default_settings_document()
        await db.payment_gateway_settings.insert_one(doc)
    return doc


async def _active_env(db) -> Dict[str, str]:
    """Returns the currently active {key, salt, base_url} triplet."""
    s = await _load_settings(db)
    if not s.get("enabled"):
        raise HTTPException(503, "Payment gateway is disabled by admin")
    env = s.get("environment", "sandbox")
    block = s.get(env) or {}
    if not (block.get("key") and block.get("salt") and block.get("base_url")):
        raise HTTPException(
            503,
            f"Easebuzz {env} credentials missing — set them from Admin → Payment Settings",
        )
    return {"env": env, **block, "settings": s}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_txnid() -> str:
    return "BT" + _now().strftime("%y%m%d%H%M%S") + os.urandom(3).hex().upper()


async def _log(db, kind: str, txnid: Optional[str], data: Dict[str, Any]) -> None:
    try:
        await db.payment_logs.insert_one({
            "kind": kind,
            "txnid": txnid,
            "data": data,
            "created_at": _now(),
        })
    except Exception:
        log.exception("payment_logs insert failed")


def _frontend_return_url(settings: Dict[str, Any], txnid: str, status: str) -> str:
    """Build the frontend URL we redirect the browser to after callback."""
    path = settings.get("success_url") if status == "success" else settings.get("failure_url")
    path = path or "/booking/payment-return"
    if path.startswith("http"):
        base = ""
    else:
        base = os.environ.get("FRONTEND_URL", "").rstrip("/")
    return f"{base}{path}?txnid={txnid}&status={status}"


async def _finalise_bookings_after_success(
    db, pay_doc: Dict[str, Any], gateway_response: Dict[str, Any],
    new_id, utcnow,
) -> Dict[str, Any]:
    """Flip every booking in the payment to `token_paid` and start the 24h
    confirmation clock. Idempotent — bookings already past `pending_payment`
    are skipped. Also fires the payment receipt email (mock-safe)."""
    confirm_hours = int(os.environ.get("BOOKING_CONFIRM_WINDOW_HOURS", "24"))
    # NB: server.py's `utcnow()` returns an ISO string. Use _now() for math.
    expires_at = (_now() + timedelta(hours=confirm_hours)).isoformat()

    booking_ids = pay_doc.get("booking_ids") or ([pay_doc["booking_id"]] if pay_doc.get("booking_id") else [])
    docs = await db.bookings.find({"id": {"$in": booking_ids}}).to_list(50)
    refs: List[str] = []
    receipt_email: Optional[str] = None
    receipt_name: Optional[str] = None
    receipt_artist: Optional[str] = None
    receipt_event_date: Optional[str] = None
    for d in docs:
        refs.append(d.get("ref", d["id"]))
        if not receipt_email:
            receipt_email = d.get("customer_email")
            receipt_name = d.get("customer_name")
            receipt_event_date = d.get("event_date")
        if d.get("status") != "pending_payment":
            continue
        share = float((d.get("pricing") or {}).get("token_amount", 0) or 0)
        await db.bookings.update_one(
            {"id": d["id"]},
            {"$set": {
                "payment_status": "token_paid",
                "amount_paid": share,
                "status": "pending_artist",
                "expires_at": expires_at,
                "confirmation_deadline_hours": confirm_hours,
             },
             "$push": {"history": {
                 "at": utcnow(), "action": "paid_token_easebuzz",
                 "by": pay_doc.get("user_id"), "amount": share,
                 "payment_id": pay_doc["id"], "gateway": "easebuzz",
                 "easepayid": gateway_response.get("easepayid"),
             }}},
        )
        await db.transactions.insert_one({
            "id": new_id(), "user_id": pay_doc.get("user_id"), "type": "payment",
            "amount": -share, "status": "completed",
            "description": f"Token paid via Easebuzz for booking {d.get('ref', d['id'])}",
            "booking_id": d["id"], "gateway": "easebuzz",
            "created_at": utcnow(),
        })
        await db.notifications.insert_one({
            "id": new_id(), "user_id": d["artist_id"], "type": "booking_request",
            "title": "New paid booking request",
            "body": f"Token received for booking {d.get('ref', d['id'])}",
            "read": False, "created_at": utcnow(),
            "link": f"/dashboard/bookings/{d['id']}",
        })

    # Look up artist stage name for the first booking to enrich the receipt.
    if docs:
        try:
            ap = await db.artist_profiles.find_one({"user_id": docs[0]["artist_id"]}) or {}
            au = await db.users.find_one({"id": docs[0]["artist_id"]}) or {}
            receipt_artist = ap.get("stage_name") or f"{au.get('first_name', '')} {au.get('last_name', '')}".strip()
        except Exception:
            pass

    # Fire receipt email (mock-safe when RESEND_API_KEY empty).
    try:
        from email_service import send_payment_receipt_email
        await send_payment_receipt_email(
            to_email=receipt_email or "",
            name=receipt_name or "",
            booking_refs=refs,
            amount=float(pay_doc.get("amount", 0) or 0),
            txnid=pay_doc.get("txnid", ""),
            gateway="easebuzz",
            easepayid=str(gateway_response.get("easepayid") or ""),
            artist_name=receipt_artist or "",
            event_date=receipt_event_date or "",
        )
    except Exception as e:
        log.warning("Receipt email dispatch failed: %s", e)

    return {"booking_refs": refs, "count": len(docs)}


# ────────────────────────────────────────────────────────────────────────────
# Router factory
# ────────────────────────────────────────────────────────────────────────────
def make_easebuzz_router(*, db, get_current_user, admin_only, new_id, utcnow,
                         activate_subscription=None, activate_boost=None) -> APIRouter:
    """Args:
        activate_subscription: async fn(user_id, plan_code, billing_cycle, price,
                                        payment_method) -> None.
        activate_boost:        async fn(user_id, pkg, price, payment_method,
                                        payment_ref) -> None.
        Injected from server.py so we don't hard-depend on their routers.
    """
    r = APIRouter()

    async def _notify_admins(kind: str, user_id: str, amount: float, meta: Dict[str, Any]):
        """Iter 63.3 — Alert every admin the instant an artist completes a
        subscription or boost payment."""
        try:
            u = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "first_name": 1, "last_name": 1}) or {}
            display = (u.get("first_name") or "") + " " + (u.get("last_name") or "")
            display = display.strip() or u.get("email", "an artist")
            title = f"{'Subscription' if kind == 'subscription' else 'Boost'} payment received"
            body = f"{display} paid ₹{amount:,.2f} — {meta.get('label', kind)}"
            admin_cursor = db.users.find({"role": "admin"}, {"_id": 0, "id": 1})
            async for a in admin_cursor:
                await db.notifications.insert_one({
                    "id": new_id(), "user_id": a["id"],
                    "type": f"payment.{kind}",
                    "title": title, "body": body,
                    "link": "/admin?tab=payment-recon",
                    "meta": {"user_id": user_id, "amount": amount, **meta},
                    "read": False, "created_at": _now(),
                })
        except Exception:
            log.warning("Admin notify failed", exc_info=True)

    async def _finalise_payment(pay: Dict[str, Any], gateway_response: Dict[str, Any]):
        """Dispatch on payment_kind."""
        kind = pay.get("payment_kind") or "booking"
        if kind == "subscription" and activate_subscription:
            await activate_subscription(
                user_id=pay["user_id"],
                plan_code=pay["subscription_plan"],
                billing_cycle=pay.get("subscription_cycle", "monthly"),
                price=float(pay.get("amount", 0) or 0),
                payment_method="easebuzz",
            )
            await _notify_admins("subscription", pay["user_id"], float(pay.get("amount", 0) or 0),
                                 {"label": pay.get("subscription_plan", "").title() + " plan",
                                  "txnid": pay.get("txnid"), "easepayid": gateway_response.get("easepayid")})
            return
        if kind == "boost" and activate_boost:
            pkg = await db.boost_packages.find_one({"id": pay["boost_package_id"]}) or {}
            await activate_boost(
                user_id=pay["user_id"], pkg=pkg,
                price=float(pay.get("amount", 0) or 0),
                payment_method="easebuzz",
                payment_ref=pay.get("easepayid") or pay.get("txnid"),
            )
            await _notify_admins("boost", pay["user_id"], float(pay.get("amount", 0) or 0),
                                 {"label": pkg.get("name", "Boost package"),
                                  "txnid": pay.get("txnid"), "easepayid": gateway_response.get("easepayid")})
            return
        # Default: booking flow.
        await _finalise_bookings_after_success(db, pay, gateway_response, new_id, utcnow)

    # ───── Admin settings ────────────────────────────────────────────────
    @r.get("/admin/payment-settings")
    async def get_payment_settings(admin: dict = Depends(admin_only)):
        s = await _load_settings(db)
        s.pop("_id", None)
        return s

    @r.put("/admin/payment-settings")
    async def update_payment_settings(
        body: PaymentSettingsUpdate, admin: dict = Depends(admin_only),
    ):
        if admin.get("admin_role") not in (None, "super_admin"):
            raise HTTPException(403, "Super admin only")
        current = await _load_settings(db)
        update: Dict[str, Any] = {}
        if body.enabled is not None:
            update["enabled"] = body.enabled
        if body.environment is not None:
            update["environment"] = body.environment
        if body.sandbox is not None:
            update["sandbox"] = {**current.get("sandbox", {}), **body.sandbox.model_dump()}
        if body.live is not None:
            update["live"] = {**current.get("live", {}), **body.live.model_dump()}
        if body.success_url is not None:
            update["success_url"] = body.success_url
        if body.failure_url is not None:
            update["failure_url"] = body.failure_url
        if body.webhook_url is not None:
            update["webhook_url"] = body.webhook_url
        update["updated_at"] = _now()
        update["updated_by"] = admin.get("email")
        await db.payment_gateway_settings.update_one(
            {"_id": "active"}, {"$set": update}, upsert=True,
        )
        s = await _load_settings(db)
        s.pop("_id", None)
        return s

    # ───── Admin reconciliation report ───────────────────────────────────
    @r.get("/admin/payments")
    async def admin_list_payments(
        admin: dict = Depends(admin_only),
        gateway: Optional[str] = None,
        status: Optional[str] = None,
        kind: Optional[str] = None,
        q: Optional[str] = None,
        page: int = 1,
        limit: int = 25,
    ):
        """Paginated list of payment records for the finance/reconciliation UI.
        Filters: gateway (`easebuzz` / `razorpay` / `razorpay_mock`),
                 status (`pending` / `completed` / `failed`),
                 kind (`booking` / `subscription` / `boost`),
                 q (partial match on txnid, easepayid, booking ref)."""
        query: Dict[str, Any] = {}
        if gateway:
            query["gateway"] = gateway
        if status:
            query["status"] = status
        if kind:
            # payment_kind is only set for non-booking rows; booking rows have
            # no field so treat missing as "booking".
            if kind == "booking":
                query["$or"] = [{"payment_kind": {"$exists": False}}, {"payment_kind": "booking"}]
            else:
                query["payment_kind"] = kind
        if q:
            q_regex = {"$regex": q.strip(), "$options": "i"}
            or_clauses = [
                {"txnid": q_regex}, {"easepayid": q_regex},
                {"razorpay_order_id": q_regex}, {"booking_id": q_regex},
            ]
            if "$or" in query:
                query["$and"] = [{"$or": query.pop("$or")}, {"$or": or_clauses}]
            else:
                query["$or"] = or_clauses
        limit = max(1, min(limit, 100))
        page = max(1, page)
        total = await db.payments.count_documents(query)
        cursor = db.payments.find(query, {"_id": 0}).sort("created_at", -1) \
            .skip((page - 1) * limit).limit(limit)
        items = await cursor.to_list(limit)
        # Attach booking refs for display convenience.
        all_bids: List[str] = []
        for it in items:
            all_bids.extend(it.get("booking_ids") or ([it["booking_id"]] if it.get("booking_id") else []))
        ref_map: Dict[str, str] = {}
        if all_bids:
            async for b in db.bookings.find(
                {"id": {"$in": all_bids}}, {"_id": 0, "id": 1, "ref": 1},
            ):
                ref_map[b["id"]] = b.get("ref") or b["id"]
        for it in items:
            bids = it.get("booking_ids") or ([it["booking_id"]] if it.get("booking_id") else [])
            it["booking_refs"] = [ref_map.get(bid, bid) for bid in bids]
            # Compact gateway_response for the table (full doc still in DB).
            gr = it.get("gateway_response")
            if isinstance(gr, dict):
                it["gateway_response_summary"] = {
                    "status": gr.get("status"),
                    "easepayid": gr.get("easepayid"),
                    "mode": gr.get("mode"),
                    "bank_ref_num": gr.get("bank_ref_num"),
                    "error_Message": gr.get("error_Message"),
                }
                it.pop("gateway_response", None)
        return {"items": items, "total": total, "page": page, "limit": limit}

    @r.get("/admin/payment-logs")
    async def admin_list_payment_logs(
        admin: dict = Depends(admin_only),
        txnid: Optional[str] = None,
        kind: Optional[str] = None,
        page: int = 1,
        limit: int = 50,
    ):
        """Raw request/response log entries. Every initiate, callback, hash-
        mismatch, retrieve and webhook lands here — this is the source of
        truth for finance debugging."""
        query: Dict[str, Any] = {}
        if txnid:
            query["txnid"] = txnid.strip()
        if kind:
            query["kind"] = {"$regex": kind.strip(), "$options": "i"}
        limit = max(1, min(limit, 200))
        page = max(1, page)
        total = await db.payment_logs.count_documents(query)
        cursor = db.payment_logs.find(query, {"_id": 0}).sort("created_at", -1) \
            .skip((page - 1) * limit).limit(limit)
        items = await cursor.to_list(limit)
        return {"items": items, "total": total, "page": page, "limit": limit}

    @r.get("/admin/payments/summary")
    async def admin_payments_summary(admin: dict = Depends(admin_only)):
        """Top-line counts for the reconciliation dashboard header."""
        pipeline = [
            {"$group": {
                "_id": {"gateway": "$gateway", "status": "$status"},
                "count": {"$sum": 1},
                "amount": {"$sum": "$amount"},
            }},
        ]
        rows = await db.payments.aggregate(pipeline).to_list(200)
        # Also count hash mismatches from the logs.
        hash_mismatches = await db.payment_logs.count_documents(
            {"kind": "easebuzz.callback.hash_mismatch"},
        )
        return {"breakdown": rows, "hash_mismatches": hash_mismatches}

    # ───── Public status (used by frontend to decide gateway) ────────────
    @r.get("/payment-gateway/public")
    async def public_gateway_info():
        """Only the fields safe to expose to logged-in customers."""
        s = await _load_settings(db)
        return {
            "provider": s.get("provider", "easebuzz"),
            "enabled": bool(s.get("enabled")),
            "environment": s.get("environment", "sandbox"),        }

    # ───── Init payment ──────────────────────────────────────────────────
    @r.post("/payments/easebuzz/init")
    async def easebuzz_init(body: EasebuzzInitBody, user: dict = Depends(get_current_user)):
        if not body.booking_ids:
            raise HTTPException(400, "booking_ids required")
        docs = await db.bookings.find({"id": {"$in": body.booking_ids}}).to_list(20)
        if len(docs) != len(body.booking_ids):
            raise HTTPException(404, "Some bookings not found")
        for d in docs:
            if d.get("customer_id") != user["id"]:
                raise HTTPException(403, "Not your booking")
            if d.get("status") != "pending_payment":
                raise HTTPException(400, f"Booking {d.get('ref', d['id'])} is not awaiting payment")

        cfg = await _active_env(db)
        total = round(sum(float((d.get("pricing") or {}).get("token_amount", 0) or 0) for d in docs), 2)
        amount = normalise_amount(total)
        txnid = _new_txnid()
        payment_id = new_id()
        first_booking = docs[0]

        firstname = (user.get("first_name") or first_booking.get("customer_name") or "Customer").strip()
        email = (user.get("email") or first_booking.get("customer_email") or "no-reply@booktalent.com").strip()
        raw_phone = (first_booking.get("customer_phone") or user.get("phone") or "").strip()
        # Easebuzz expects a plain 10-digit Indian mobile — strip +91, spaces, dashes.
        digits = "".join(ch for ch in raw_phone if ch.isdigit())
        if len(digits) > 10:
            digits = digits[-10:]
        phone = digits if len(digits) == 10 else "9999999999"
        productinfo = f"BookTalent Booking - {len(docs)} artist{'s' if len(docs) > 1 else ''}"

        # Our own return URLs. Easebuzz will POST here.
        backend_base = os.environ.get("BACKEND_PUBLIC_URL", "").rstrip("/")
        surl = f"{backend_base}/api/payments/easebuzz/callback/success"
        furl = f"{backend_base}/api/payments/easebuzz/callback/failure"

        payload: Dict[str, Any] = {
            "key": cfg["key"],
            "txnid": txnid,
            "amount": amount,
            "productinfo": productinfo,
            "firstname": firstname,
            "email": email,
            "phone": phone,
            "surl": surl,
            "furl": furl,
            # Reserve udf1 for our own payment_id so we can dedupe callbacks.
            "udf1": payment_id,
            "udf2": user["id"],
            **{f"udf{i}": "" for i in range(3, 11)},
        }
        payload["hash"] = build_initiate_hash(payload, cfg["salt"])

        await _log(db, "easebuzz.initiate.request", txnid, {
            **{k: v for k, v in payload.items() if k != "hash"},
            "hash_len": len(payload["hash"]),
        })

        try:
            resp = await initiate_link(cfg["base_url"], payload)
        except Exception as e:
            log.exception("Easebuzz initiate failed")
            raise HTTPException(502, f"Payment gateway error: {e}")

        await _log(db, "easebuzz.initiate.response", txnid, resp)

        # Easebuzz response shape: {"status": 1, "data": "<access_key>"} on success,
        # or {"status": 0, "data": "<error msg>"} on failure.
        if not isinstance(resp, dict) or resp.get("status") != 1:
            raise HTTPException(502, f"Easebuzz declined: {resp.get('data') if isinstance(resp, dict) else resp}")

        access_key = resp.get("data")
        if not access_key or not isinstance(access_key, str):
            raise HTTPException(502, "Easebuzz returned no access_key")

        payment_url = f"{cfg['base_url'].rstrip('/')}/pay/{access_key}"

        pay_doc = {
            "id": payment_id,
            "gateway": "easebuzz",
            "environment": cfg["env"],
            "booking_ids": body.booking_ids,
            "booking_id": body.booking_ids[0] if len(body.booking_ids) == 1 else None,
            "user_id": user["id"],
            "amount": total,
            "method": body.method or "hosted",
            "status": "pending",
            "txnid": txnid,
            "access_key": access_key,
            "payment_url": payment_url,
            "created_at": _now(),
            "batch": len(body.booking_ids) > 1,
        }
        await db.payments.insert_one(pay_doc)

        return {
            "payment_id": payment_id,
            "gateway": "easebuzz",
            "environment": cfg["env"],
            "amount": total,
            "txnid": txnid,
            "access_key": access_key,
            "payment_url": payment_url,
        }

    # ───── Init: SUBSCRIPTION checkout ───────────────────────────────────
    async def _init_generic(user: dict, amount: float, productinfo: str,
                            payment_kind: str, extra: Dict[str, Any]) -> Dict[str, Any]:
        """Shared Easebuzz-init helper for non-booking payment kinds."""
        # Iter 63.3 — Easebuzz rejects non-ASCII in productinfo with cryptic
        # GC0E01. Strip anything outside plain ASCII printable range.
        productinfo = "".join(ch for ch in (productinfo or "BookTalent") if 32 <= ord(ch) < 127).strip() or "BookTalent"
        cfg = await _active_env(db)
        amount_str = normalise_amount(amount)
        txnid = _new_txnid()
        payment_id = new_id()
        firstname = (user.get("first_name") or "Customer").strip()
        email = (user.get("email") or "no-reply@booktalent.com").strip()
        raw_phone = (user.get("phone") or "").strip()
        digits = "".join(ch for ch in raw_phone if ch.isdigit())
        phone = digits[-10:] if len(digits) >= 10 else "9999999999"
        backend_base = os.environ.get("BACKEND_PUBLIC_URL", "").rstrip("/")
        payload: Dict[str, Any] = {
            "key": cfg["key"], "txnid": txnid, "amount": amount_str,
            "productinfo": productinfo, "firstname": firstname,
            "email": email, "phone": phone,
            "surl": f"{backend_base}/api/payments/easebuzz/callback/success",
            "furl": f"{backend_base}/api/payments/easebuzz/callback/failure",
            "udf1": payment_id, "udf2": user["id"], "udf3": payment_kind,
            **{f"udf{i}": "" for i in range(4, 11)},
        }
        payload["hash"] = build_initiate_hash(payload, cfg["salt"])
        await _log(db, f"easebuzz.initiate.request.{payment_kind}", txnid,
                   {k: v for k, v in payload.items() if k != "hash"})
        try:
            resp = await initiate_link(cfg["base_url"], payload)
        except Exception as e:
            raise HTTPException(502, f"Payment gateway error: {e}")
        await _log(db, f"easebuzz.initiate.response.{payment_kind}", txnid, resp)
        if not isinstance(resp, dict) or resp.get("status") != 1:
            raise HTTPException(502, f"Easebuzz declined: {resp.get('data') if isinstance(resp, dict) else resp}")
        access_key = resp.get("data")
        payment_url = f"{cfg['base_url'].rstrip('/')}/pay/{access_key}"
        pay_doc = {
            "id": payment_id, "gateway": "easebuzz",
            "environment": cfg["env"], "user_id": user["id"],
            "amount": float(amount_str), "status": "pending",
            "txnid": txnid, "access_key": access_key, "payment_url": payment_url,
            "created_at": _now(), "payment_kind": payment_kind, **extra,
        }
        await db.payments.insert_one(pay_doc)
        return {"payment_id": payment_id, "gateway": "easebuzz",
                "environment": cfg["env"], "amount": float(amount_str),
                "txnid": txnid, "access_key": access_key, "payment_url": payment_url}

    @r.post("/subscriptions/easebuzz/init")
    async def easebuzz_subscription_init(body: SubInitBody, user: dict = Depends(get_current_user)):
        if user.get("role") not in ("artist", "agency"):
            raise HTTPException(403, "Only artists / agencies can subscribe")
        _PLAN_PRICES = {
            "silver":   {"monthly": 499,  "yearly": 4990},
            "gold":     {"monthly": 999,  "yearly": 9990},
            "platinum": {"monthly": 2499, "yearly": 24990},
            "elite":    {"monthly": 4999, "yearly": 49990},
        }
        plan_key = body.plan.lower()
        if plan_key not in _PLAN_PRICES:
            raise HTTPException(400, "Invalid plan (free is direct — no payment)")
        cycle = "yearly" if body.billing_cycle == "yearly" else "monthly"
        price = _PLAN_PRICES[plan_key][cycle]
        productinfo = f"BookTalent {plan_key.title()} - {cycle}"
        return await _init_generic(
            user=user, amount=price, productinfo=productinfo,
            payment_kind="subscription",
            extra={"subscription_plan": plan_key, "subscription_cycle": cycle},
        )

    @r.post("/boost/easebuzz/init")
    async def easebuzz_boost_init(body: BoostInitBody, user: dict = Depends(get_current_user)):
        if user.get("role") != "artist":
            raise HTTPException(403, "Only artists can buy boost packages")
        pkg = await db.boost_packages.find_one({"id": body.package_id, "active": True})
        if not pkg:
            raise HTTPException(404, "Boost package not found or inactive")
        gst = round(pkg["price"] * pkg.get("gst_pct", 18) / 100, 2)
        total = round(pkg["price"] + gst, 2)
        return await _init_generic(
            user=user, amount=total, productinfo=f"BookTalent Boost - {pkg['name']}",
            payment_kind="boost", extra={"boost_package_id": pkg["id"]},
        )

    # ───── Callbacks ─────────────────────────────────────────────────────
    async def _handle_callback(request: Request, expected_status_hint: str) -> RedirectResponse:
        form = dict(await request.form())
        txnid = form.get("txnid") or ""
        status = (form.get("status") or "").lower()
        await _log(db, f"easebuzz.callback.{expected_status_hint}", txnid, form)

        cfg_settings = await _load_settings(db)
        env = cfg_settings.get("environment", "sandbox")
        env_block = cfg_settings.get(env) or {}
        salt = env_block.get("salt", "")
        base_url = env_block.get("base_url", "")

        # Hash verify
        received_hash = form.get("hash", "")
        expected_hash = build_response_hash(form, salt)
        if not received_hash or received_hash.lower() != expected_hash:
            await _log(db, "easebuzz.callback.hash_mismatch", txnid, {
                "received": received_hash, "expected": expected_hash,
            })
            return RedirectResponse(
                _frontend_return_url(cfg_settings, txnid, "failure"),
                status_code=303,
            )

        pay = await db.payments.find_one({"txnid": txnid, "gateway": "easebuzz"})
        if not pay:
            # Unknown txnid → still redirect user gracefully.
            return RedirectResponse(
                _frontend_return_url(cfg_settings, txnid, "failure"),
                status_code=303,
            )

        # Idempotency: if already completed, no-op.
        if pay.get("status") == "completed":
            return RedirectResponse(
                _frontend_return_url(cfg_settings, txnid, "success"),
                status_code=303,
            )

        if status == "success":
            # Re-verify via retrieve API before flipping any booking.
            verify_payload = {
                "key": env_block.get("key", ""),
                "txnid": txnid,
                "amount": form.get("amount", ""),
                "email": form.get("email", ""),
                "phone": form.get("phone", ""),
            }
            verify_payload["hash"] = build_retrieve_hash(verify_payload, salt)
            try:
                retrieve = await retrieve_txn(base_url, verify_payload)
            except Exception as e:
                retrieve = {"status": 0, "error": str(e)}
            await _log(db, "easebuzz.retrieve.response", txnid, retrieve)

            retrieved_status = ""
            try:
                rd = retrieve.get("msg") or retrieve.get("data") or {}
                if isinstance(rd, dict):
                    retrieved_status = str(rd.get("status", "")).lower()
            except Exception:
                pass

            if retrieved_status and retrieved_status != "success":
                # Retrieve disagrees — treat as failure.
                await db.payments.update_one(
                    {"id": pay["id"]},
                    {"$set": {"status": "failed",
                              "failure_reason": f"retrieve_status={retrieved_status}",
                              "gateway_response": form,
                              "gateway_retrieve": retrieve,
                              "verified_at": _now()}},
                )
                return RedirectResponse(
                    _frontend_return_url(cfg_settings, txnid, "failure"),
                    status_code=303,
                )

            await db.payments.update_one(
                {"id": pay["id"]},
                {"$set": {
                    "status": "completed",
                    "easepayid": form.get("easepayid"),
                    "gateway_response": form,
                    "gateway_retrieve": retrieve,
                    "verified_at": _now(),
                }},
            )
            await _finalise_payment(pay, form)
            return RedirectResponse(
                _frontend_return_url(cfg_settings, txnid, "success"),
                status_code=303,
            )

        # Failure / dropped / userCancelled
        await db.payments.update_one(
            {"id": pay["id"]},
            {"$set": {"status": "failed",
                      "failure_reason": form.get("error_Message") or form.get("error") or status or "unknown",
                      "gateway_response": form,
                      "verified_at": _now()}},
        )
        return RedirectResponse(
            _frontend_return_url(cfg_settings, txnid, "failure"),
            status_code=303,
        )

    @r.post("/payments/easebuzz/callback/success")
    async def easebuzz_callback_success(request: Request):
        return await _handle_callback(request, "success")

    @r.post("/payments/easebuzz/callback/failure")
    async def easebuzz_callback_failure(request: Request):
        return await _handle_callback(request, "failure")

    # Some tenants configure a separate webhook URL. Same logic, no redirect
    # — respond with plain JSON 200 so Easebuzz doesn't retry.
    @r.post("/payments/easebuzz/webhook")
    async def easebuzz_webhook(request: Request):
        form = dict(await request.form())
        txnid = form.get("txnid") or ""
        await _log(db, "easebuzz.webhook", txnid, form)
        cfg_settings = await _load_settings(db)
        env = cfg_settings.get("environment", "sandbox")
        env_block = cfg_settings.get(env) or {}
        salt = env_block.get("salt", "")
        if build_response_hash(form, salt) != (form.get("hash") or "").lower():
            return JSONResponse({"ok": False, "reason": "hash_mismatch"}, status_code=400)
        pay = await db.payments.find_one({"txnid": txnid, "gateway": "easebuzz"})
        if not pay or pay.get("status") == "completed":
            return {"ok": True, "idempotent": True}
        if (form.get("status") or "").lower() == "success":
            await db.payments.update_one(
                {"id": pay["id"]},
                {"$set": {"status": "completed", "gateway_response": form,
                          "easepayid": form.get("easepayid"),
                          "verified_at": _now()}},
            )
            await _finalise_payment(pay, form)
            return {"ok": True, "status": "completed"}
        await db.payments.update_one(
            {"id": pay["id"]},
            {"$set": {"status": "failed", "gateway_response": form, "verified_at": _now()}},
        )
        return {"ok": True, "status": "failed"}

    # ───── Status poll (frontend return page uses this) ──────────────────
    @r.get("/payments/easebuzz/status/{txnid}")
    async def easebuzz_status(txnid: str, user: dict = Depends(get_current_user)):
        pay = await db.payments.find_one({"txnid": txnid, "gateway": "easebuzz"})
        if not pay:
            raise HTTPException(404, "Payment not found")
        if pay.get("user_id") != user["id"] and user.get("role") != "admin":
            raise HTTPException(403, "Not your payment")
        booking_ids = pay.get("booking_ids") or ([pay["booking_id"]] if pay.get("booking_id") else [])
        bookings = await db.bookings.find(
            {"id": {"$in": booking_ids}},
            {"_id": 0, "id": 1, "ref": 1, "status": 1, "payment_status": 1,
             "event_id": 1, "artist_id": 1, "event_date": 1},
        ).to_list(20)
        return {
            "txnid": txnid,
            "status": pay.get("status"),
            "amount": pay.get("amount"),
            "gateway": "easebuzz",
            "environment": pay.get("environment"),
            "easepayid": pay.get("easepayid"),
            "failure_reason": pay.get("failure_reason"),
            "bookings": bookings,
            "batch": pay.get("batch", False),
            "event_id": bookings[0].get("event_id") if bookings else None,
        }

    return r
