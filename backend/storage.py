"""
Iter 76 — Emergent Object Storage helper for large-file (video) uploads.

Photos & small documents continue to use the legacy base64-in-Mongo path
in `server.py`. Only VIDEO uploads (up to 1GB) route through here.

Usage
-----
```
from storage import init_storage, put_object, get_object

# At FastAPI startup:
init_storage()

# When persisting a video:
result = put_object("booktalent/videos/<uuid>.mp4", raw_bytes, "video/mp4")
# result["path"] is the canonical storage path — persist it in the DB.

# When streaming back:
data, mime = get_object(stored_path)
```
"""

from __future__ import annotations

import logging
import os
from typing import Tuple

import requests

log = logging.getLogger("storage")

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() \
    or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "booktalent"

# Module-level. Set once at startup, reused across every request. The key
# is session-scoped upstream, so re-initing per request would waste time
# and mask permission issues.
_storage_key: str | None = None


def init_storage(force: bool = False) -> str:
    """Fetch (or refresh) the session storage key. Idempotent."""
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    if not EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY is not set — cannot init object storage")
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": EMERGENT_KEY},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    log.info("Object storage session initialised")
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    """Upload `data` under `path`. Overwrites on collision (upstream contract)."""
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=600,  # generous — a 1GB PUT can take a while
    )
    if resp.status_code == 404:
        # Key expired — refresh once and retry.
        key = init_storage(force=True)
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=600,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> Tuple[bytes, str]:
    """Return `(bytes, content_type)` for the stored object."""
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=120,
    )
    if resp.status_code == 404:
        # Try a key refresh once — 404 covers "key unknown" AND "path missing";
        # we can't tell without retrying.
        key = init_storage(force=True)
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key}, timeout=120,
        )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
