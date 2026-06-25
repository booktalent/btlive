"""
Live chat — WebSocket based 1-1 messaging tied to a booking.

Endpoint:    /api/ws/chat/{booking_id}?token=<jwt>
Persistence: db.chat_messages
REST:        GET  /api/chat/{booking_id}/messages
             POST /api/chat/{booking_id}/messages   (REST fallback)
             POST /api/chat/{booking_id}/read        (mark all as read)
"""
from __future__ import annotations

import os
import uuid
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from jwt import decode as jwt_decode, PyJWTError
from pydantic import BaseModel

log = logging.getLogger("booktalent.chat")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def clean(d):
    if not d:
        return d
    d.pop("_id", None)
    return d


class ChatMessageBody(BaseModel):
    content: str
    type: str = "text"  # text | system | image-ref


class ConnectionManager:
    """In-process room manager. Keyed by booking_id → set of (ws, user_id)."""
    def __init__(self):
        self.rooms: Dict[str, Set[tuple]] = {}

    async def connect(self, room: str, ws: WebSocket, user_id: str):
        await ws.accept()
        self.rooms.setdefault(room, set()).add((ws, user_id))

    def disconnect(self, room: str, ws: WebSocket, user_id: str):
        if room in self.rooms:
            self.rooms[room].discard((ws, user_id))
            if not self.rooms[room]:
                self.rooms.pop(room, None)

    async def broadcast(self, room: str, payload: dict, exclude_ws: Optional[WebSocket] = None):
        dead = []
        for ws, _uid in list(self.rooms.get(room, [])):
            if ws is exclude_ws:
                continue
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append((ws, _uid))
        for ws, uid in dead:
            self.disconnect(room, ws, uid)

    def participants(self, room: str) -> List[str]:
        return list({uid for _, uid in self.rooms.get(room, set())})


def make_chat_router(db, get_current_user) -> APIRouter:
    r = APIRouter()
    manager = ConnectionManager()

    async def _check_access(booking_id: str, user_id: str, role: str) -> dict:
        b = await db.bookings.find_one({"id": booking_id})
        if not b:
            raise HTTPException(404, "Booking not found")
        if role != "admin" and user_id not in (b.get("customer_id"), b.get("artist_id")):
            raise HTTPException(403, "Not a participant on this booking")
        return b

    @r.get("/chat/{booking_id}/messages")
    async def list_messages(booking_id: str, limit: int = 200, user: dict = Depends(get_current_user)):
        await _check_access(booking_id, user["id"], user["role"])
        msgs = await db.chat_messages.find({"booking_id": booking_id}).sort("created_at", 1).to_list(limit)
        return [clean(m) for m in msgs]

    @r.post("/chat/{booking_id}/messages")
    async def post_message(booking_id: str, body: ChatMessageBody, user: dict = Depends(get_current_user)):
        booking = await _check_access(booking_id, user["id"], user["role"])
        msg = {
            "id": new_id(),
            "booking_id": booking_id,
            "sender_id": user["id"],
            "sender_role": user["role"],
            "sender_name": f"{user.get('first_name', '')} {user.get('last_name', '')}".strip() or user.get("email", ""),
            "content": body.content[:4000],
            "type": body.type,
            "read_by": [user["id"]],
            "created_at": utcnow(),
        }
        await db.chat_messages.insert_one(msg)
        # Push to anyone live in the room
        await manager.broadcast(booking_id, {"event": "message", "message": clean(dict(msg))})
        # Off-line notification: write an in-app row for the other party
        other = booking["artist_id"] if user["id"] == booking["customer_id"] else booking["customer_id"]
        if other and other not in manager.participants(booking_id):
            try:
                await db.notifications.insert_one({
                    "id": new_id(),
                    "user_id": other,
                    "type": "chat",
                    "title": f"New message from {msg['sender_name']}",
                    "body": body.content[:120],
                    "link": f"/dashboard/bookings/{booking_id}",
                    "read": False,
                    "created_at": utcnow(),
                })
            except Exception:
                pass
        return clean(dict(msg))

    @r.post("/chat/{booking_id}/read")
    async def mark_read(booking_id: str, user: dict = Depends(get_current_user)):
        await _check_access(booking_id, user["id"], user["role"])
        result = await db.chat_messages.update_many(
            {"booking_id": booking_id, "read_by": {"$ne": user["id"]}},
            {"$push": {"read_by": user["id"]}},
        )
        await manager.broadcast(booking_id, {"event": "read", "by": user["id"], "at": utcnow()})
        return {"ok": True, "updated": result.modified_count}

    @r.websocket("/ws/chat/{booking_id}")
    async def ws_chat(websocket: WebSocket, booking_id: str, token: str = Query(...)):
        # Authenticate from token query
        try:
            payload = jwt_decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"])
            user_id = payload.get("sub")
        except PyJWTError:
            await websocket.close(code=4001)
            return
        if not user_id:
            await websocket.close(code=4001)
            return
        user = await db.users.find_one({"id": user_id})
        if not user:
            await websocket.close(code=4001)
            return
        # Booking + access check
        booking = await db.bookings.find_one({"id": booking_id})
        if not booking:
            await websocket.close(code=4004)
            return
        if user.get("role") != "admin" and user_id not in (booking.get("customer_id"), booking.get("artist_id")):
            await websocket.close(code=4003)
            return

        await manager.connect(booking_id, websocket, user_id)
        await manager.broadcast(booking_id, {"event": "presence", "joined": user_id, "participants": manager.participants(booking_id)})
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                ev = data.get("event")
                if ev == "message":
                    content = (data.get("content") or "")[:4000]
                    if not content.strip():
                        continue
                    msg = {
                        "id": new_id(),
                        "booking_id": booking_id,
                        "sender_id": user_id,
                        "sender_role": user.get("role"),
                        "sender_name": f"{user.get('first_name', '')} {user.get('last_name', '')}".strip() or user.get("email", ""),
                        "content": content,
                        "type": data.get("type") or "text",
                        "read_by": [user_id],
                        "created_at": utcnow(),
                    }
                    await db.chat_messages.insert_one(msg)
                    await manager.broadcast(booking_id, {"event": "message", "message": clean(dict(msg))})
                    # Off-line side: write in-app notification
                    other = booking["artist_id"] if user_id == booking["customer_id"] else booking["customer_id"]
                    if other and other not in manager.participants(booking_id):
                        try:
                            await db.notifications.insert_one({
                                "id": new_id(),
                                "user_id": other,
                                "type": "chat",
                                "title": f"New message from {msg['sender_name']}",
                                "body": content[:120],
                                "link": f"/dashboard/bookings/{booking_id}",
                                "read": False,
                                "created_at": utcnow(),
                            })
                        except Exception:
                            pass
                elif ev == "typing":
                    # Ephemeral — just broadcast, don't store
                    await manager.broadcast(booking_id, {"event": "typing", "by": user_id, "name": f"{user.get('first_name', '')}".strip() or "Someone"}, exclude_ws=websocket)
                elif ev == "read":
                    await db.chat_messages.update_many(
                        {"booking_id": booking_id, "read_by": {"$ne": user_id}},
                        {"$push": {"read_by": user_id}},
                    )
                    await manager.broadcast(booking_id, {"event": "read", "by": user_id, "at": utcnow()})
        except WebSocketDisconnect:
            pass
        except Exception as e:
            log.warning("chat ws error: %s", e)
        finally:
            manager.disconnect(booking_id, websocket, user_id)
            await manager.broadcast(booking_id, {"event": "presence", "left": user_id, "participants": manager.participants(booking_id)})

    return r
