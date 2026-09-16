"""
Feb-2026 Requirement Batch 6.

Adds:
  1. Commercial Deal admin page endpoints (list, per-artist history).
  2. Booking-time deal snapshot helper (stamps % onto booking so future
     rate changes never retroactively affect old bookings).
  3. Contact-masking (redaction) helper for chat — auto-redact phone/
     email in messages when the booking is for a Service artist, plus
     a fire-and-forget Slack alert on any hit.
  4. Deal-change history reader (backed by existing audit_logs rows).
  5. (Bank Preset Column Mapper UI lives client-side — this router only
     exposes the existing CRUD from req_batch_5.)

All helpers are idempotent and safe to call multiple times.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

log = logging.getLogger("req_batch_6")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ═══════════════════════════════════════════════════════════════════════
# (2) Booking-time deal snapshot
# ═══════════════════════════════════════════════════════════════════════
async def build_deal_snapshot(db: AsyncIOMotorDatabase, artist_id: str) -> Dict[str, Any]:
    """Read the artist's current commercial deal and return a compact
    snapshot dict for embedding into a booking document.
    Safe to call in any create-booking path — never raises.
    """
    try:
        prof = await db.artist_profiles.find_one(
            {"user_id": artist_id},
            {"_id": 0, "artist_type": 1, "is_service_artist": 1,
             "percentage_deal": 1, "commercial_deal_set_at": 1},
        ) or {}
    except Exception:  # pragma: no cover
        prof = {}
    return {
        "artist_type": prof.get("artist_type") or ("service" if prof.get("is_service_artist") else "normal"),
        "is_service_artist": bool(prof.get("is_service_artist")),
        "percentage_deal": float(prof.get("percentage_deal") or 0),
        "profile_deal_set_at": prof.get("commercial_deal_set_at"),
        "snapshot_at": utcnow(),
    }


async def stamp_deal_snapshot_on_booking(db: AsyncIOMotorDatabase, booking_id: str,
                                          artist_id: str) -> None:
    """Idempotent — writes the snapshot only if the booking doesn't
    already carry one."""
    existing = await db.bookings.find_one({"id": booking_id, "deal_snapshot": {"$exists": True}},
                                           {"_id": 1})
    if existing:
        return
    snap = await build_deal_snapshot(db, artist_id)
    await db.bookings.update_one({"id": booking_id}, {"$set": {"deal_snapshot": snap}})


# ═══════════════════════════════════════════════════════════════════════
# (3) Contact-masking / redaction
# ═══════════════════════════════════════════════════════════════════════
# Deliberately conservative regexes so we don't accidentally mangle
# ordinary chat text.
_PHONE_RE = re.compile(
    # Indian 10-digit mobile (6-9 lead). Handles common visual formats:
    #   9876543210
    #   +91 9876543210 / +91-9876543210
    #   +91 9876 543210 / +91-9876-543210
    #   +91 98765 43210 / 98765 43210
    r"""
    (?:\+?91[\s\-]?|0)?     # optional country / trunk prefix
    [6-9]                    # first mobile digit
    (?:                      # remaining 9 digits with permissive separators
        \d{9}                    #   contiguous:  9876543210
      | \d{3}[\s\-]\d{6}         #   4-6 split:   9876 543210
      | \d{4}[\s\-]\d{5}         #   5-5 split:   98765 43210
      | \d{2}[\s\-]\d{3}[\s\-]\d{4}  # 3-3-4 split
    )
    """,
    re.VERBOSE,
)
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_URL_LEAK_RE = re.compile(r"\b(?:wa\.me|whatsapp\.com|t\.me|instagram\.com/direct)\S+", re.IGNORECASE)


def redact_contact_info(text: str) -> Tuple[str, List[Dict[str, str]]]:
    """Return (redacted_text, hits[]). Hits carry the redacted kind
    and a masked preview for auditing."""
    if not text:
        return text, []
    hits: List[Dict[str, str]] = []
    out = text

    def _mask(match_obj, kind: str) -> str:
        raw = match_obj.group(0)
        if kind == "phone":
            trimmed = re.sub(r"\D", "", raw)
            preview = f"…{trimmed[-4:]}" if len(trimmed) >= 4 else "…"
            hits.append({"kind": "phone", "preview": preview})
            return "[phone hidden]"
        if kind == "email":
            local = raw.split("@", 1)[0]
            preview = f"{local[:2]}…@…"
            hits.append({"kind": "email", "preview": preview})
            return "[email hidden]"
        hits.append({"kind": "url", "preview": raw[:24] + "…"})
        return "[link hidden]"

    # Order matters: strip URLs first so we don't double-match a phone
    # number that lives inside a wa.me/… link.
    out = _URL_LEAK_RE.sub(lambda m: _mask(m, "url"), out)
    out = _EMAIL_RE.sub(lambda m: _mask(m, "email"), out)
    out = _PHONE_RE.sub(lambda m: _mask(m, "phone"), out)
    return out, hits


async def should_enforce_masking(db: AsyncIOMotorDatabase, booking_id: str) -> bool:
    """Masking fires when either the booking's deal snapshot OR the
    live artist_profile marks this as a Service artist."""
    bk = await db.bookings.find_one({"id": booking_id},
                                     {"_id": 0, "deal_snapshot": 1, "artist_id": 1}) or {}
    snap = bk.get("deal_snapshot") or {}
    if snap.get("is_service_artist"):
        return True
    aid = bk.get("artist_id")
    if not aid:
        return False
    prof = await db.artist_profiles.find_one({"user_id": aid},
                                              {"_id": 0, "is_service_artist": 1}) or {}
    return bool(prof.get("is_service_artist"))


async def redact_and_alert(db: AsyncIOMotorDatabase, *, booking_id: str,
                            sender_id: Optional[str], sender_role: Optional[str],
                            body_original: str) -> Tuple[str, List[Dict[str, str]]]:
    """Wrapper — decides whether to mask, then fires Slack + audit if it did."""
    if not body_original:
        return body_original, []
    enforce = await should_enforce_masking(db, booking_id)
    if not enforce:
        return body_original, []
    redacted, hits = redact_contact_info(body_original)
    if not hits:
        return body_original, []

    # Slack fire-and-forget so we never break the chat write.
    try:
        from routes.iter89 import notify_slack
        bk = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "ref": 1}) or {}
        kinds = ", ".join(sorted({h["kind"] for h in hits}))
        text = (
            f":mask: *Contact leak masked* on Service-artist booking "
            f"*{bk.get('ref') or booking_id}* — hidden {len(hits)} item(s) ({kinds}) "
            f"from a {sender_role or '?'} message. Review Admin → Audit Logs if concerning."
        )
        await notify_slack(db, text=text)
    except Exception as e:  # noqa: BLE001
        log.warning("redact slack alert failed: %s", e)

    # Audit trail
    try:
        await db.audit_logs.insert_one({
            "id": str(uuid.uuid4()),
            "actor_id": sender_id,
            "actor_role": sender_role,
            "action": "chat.contact_masked",
            "entity": "booking",
            "entity_id": booking_id,
            "metadata": {"hits": hits, "chars": len(body_original)},
            "created_at": utcnow(),
        })
    except Exception:
        pass
    return redacted, hits


# ═══════════════════════════════════════════════════════════════════════
# Router
# ═══════════════════════════════════════════════════════════════════════
def make_req_batch_6_router(db: AsyncIOMotorDatabase, get_current_user, require_admin) -> APIRouter:
    r = APIRouter()

    # ── (1) Commercial-deal list for the Admin page ────────────────
    @r.get("/admin/artists/commercial-deals")
    async def list_commercial_deals(
        q: Optional[str] = Query(None, description="filter by name/email"),
        type_filter: Optional[str] = Query(None, description="normal | service"),
        limit: int = Query(500, ge=1, le=2000),
        _: dict = Depends(require_admin),
    ):
        # Roll up profile + user + rough booking counts in one page.
        profile_filter: Dict[str, Any] = {"kyc_status": {"$in": ["live", "kyc_approved", "tnc_pending"]}}
        if type_filter == "service":
            profile_filter["is_service_artist"] = True
        elif type_filter == "normal":
            profile_filter["is_service_artist"] = {"$ne": True}

        profs = await db.artist_profiles.find(
            profile_filter,
            {"_id": 0, "user_id": 1, "stage_name": 1, "artist_type": 1,
             "is_service_artist": 1, "percentage_deal": 1,
             "commercial_deal_set_at": 1, "commercial_deal_set_by": 1,
             "kyc_status": 1, "city": 1},
        ).limit(limit).to_list(limit)

        user_ids = [p["user_id"] for p in profs]
        users = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "id": 1, "email": 1, "first_name": 1, "last_name": 1},
        ).to_list(len(user_ids))
        by_uid = {u["id"]: u for u in users}

        out: List[Dict[str, Any]] = []
        for p in profs:
            u = by_uid.get(p["user_id"], {})
            name = p.get("stage_name") or (
                f"{u.get('first_name','')} {u.get('last_name','')}".strip() or u.get("email") or p["user_id"]
            )
            row = {
                "artist_id": p["user_id"],
                "name": name,
                "email": u.get("email"),
                "city": p.get("city"),
                "artist_type": p.get("artist_type") or ("service" if p.get("is_service_artist") else "normal"),
                "is_service_artist": bool(p.get("is_service_artist")),
                "percentage_deal": float(p.get("percentage_deal") or 0),
                "kyc_status": p.get("kyc_status"),
                "commercial_deal_set_at": p.get("commercial_deal_set_at"),
                "commercial_deal_set_by": p.get("commercial_deal_set_by"),
            }
            if q:
                ql = q.lower()
                blob = f"{row['name']} {row.get('email') or ''} {row.get('city') or ''}".lower()
                if ql not in blob:
                    continue
            out.append(row)

        # Summary tiles for the page header.
        totals = {
            "count": len(out),
            "service_count": sum(1 for r in out if r["is_service_artist"]),
            "normal_count": sum(1 for r in out if not r["is_service_artist"]),
            "avg_service_pct": round(
                sum(r["percentage_deal"] for r in out if r["is_service_artist"])
                / max(1, sum(1 for r in out if r["is_service_artist"])),
                2,
            ),
        }
        return {"items": out, "totals": totals}

    # ── (4) Per-artist deal-change history ─────────────────────────
    @r.get("/admin/artists/{artist_id}/deal-history")
    async def deal_history(artist_id: str, _: dict = Depends(require_admin)):
        rows = await db.audit_logs.find(
            {
                "entity_id": artist_id,
                "action": {"$in": [
                    "artist.commercial_deal_updated",
                    "kyc.approved_with_deal",
                ]},
            },
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        # Actor email hydration
        actor_ids = list({r.get("actor_id") for r in rows if r.get("actor_id")})
        actors: Dict[str, str] = {}
        if actor_ids:
            async for u in db.users.find(
                {"id": {"$in": actor_ids}},
                {"_id": 0, "id": 1, "email": 1},
            ):
                actors[u["id"]] = u.get("email") or u["id"]
        for row in rows:
            row["actor_email"] = actors.get(row.get("actor_id"))
        return {"items": rows, "count": len(rows)}

    return r
