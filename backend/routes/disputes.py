"""Dispute creation & admin resolution."""
from __future__ import annotations
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel


class DisputeBody(BaseModel):
    booking_id: str
    reason: str
    description: str = ""


class DisputeResolveBody(BaseModel):
    decision: Literal["refund", "release", "partial"]
    amount: Optional[float] = None
    note: Optional[str] = None


def make_router(
    *,
    db,
    get_current_user: Callable,
    admin_only: Callable,
    utcnow: Callable,
    new_id: Callable,
    clean: Callable,
    refund_to_wallet: Callable,
    release_payment_to_artist: Callable,
) -> APIRouter:
    r = APIRouter()

    @r.post("/disputes")
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

    @r.get("/admin/disputes")
    async def admin_disputes(_: dict = Depends(admin_only)):
        docs = await db.disputes.find().sort("created_at", -1).to_list(500)
        return [clean(d) for d in docs]

    @r.post("/admin/disputes/{did}/resolve")
    async def resolve_dispute(did: str, body: DisputeResolveBody, _: dict = Depends(admin_only)):
        d = await db.disputes.find_one({"id": did})
        if not d:
            raise HTTPException(404, "Not found")
        booking = await db.bookings.find_one({"id": d["booking_id"]})
        if body.decision == "refund":
            amount = body.amount or booking.get("amount_paid", 0)
            await refund_to_wallet(booking["customer_id"], amount, f"Dispute refund {booking['ref']}")
        elif body.decision == "release":
            await release_payment_to_artist(booking)
        elif body.decision == "partial":
            await refund_to_wallet(booking["customer_id"], body.amount or 0, f"Partial refund {booking['ref']}")
        await db.disputes.update_one(
            {"id": did},
            {"$set": {
                "status": "resolved", "decision": body.decision,
                "amount": body.amount, "note": body.note, "resolved_at": utcnow(),
            }},
        )
        return {"ok": True}

    return r
