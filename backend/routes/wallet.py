"""Wallet & withdrawal endpoints."""
from __future__ import annotations
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional


class WithdrawBody(BaseModel):
    amount: float
    bank_id: Optional[str] = None


def make_router(
    *,
    db,
    get_current_user: Callable,
    utcnow: Callable,
    new_id: Callable,
    clean: Callable,
) -> APIRouter:
    r = APIRouter()

    @r.get("/wallet")
    async def get_wallet(user: dict = Depends(get_current_user)):
        w = await db.wallets.find_one({"user_id": user["id"]})
        return clean(w) if w else {"balance": 0, "pending": 0, "total_earned": 0, "total_withdrawn": 0}

    @r.get("/wallet/transactions")
    async def wallet_tx(user: dict = Depends(get_current_user)):
        docs = await db.transactions.find({"user_id": user["id"]}).sort("created_at", -1).to_list(200)
        return [clean(d) for d in docs]

    @r.post("/wallet/withdraw")
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

    return r
