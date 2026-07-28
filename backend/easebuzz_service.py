"""
Easebuzz Payment Gateway service helpers.

- Hash generation (initiate, response verify, retrieve) per official spec.
- All configuration (Key / Salt / URLs / environment) is loaded from the
  `payment_gateway_settings` Mongo collection so it can be flipped between
  Sandbox and Live from the Admin Panel — never hardcoded.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx

log = logging.getLogger(__name__)


# Public defaults — used ONLY to seed the settings document on first boot.
# Runtime always reads from Mongo, never from these constants.
DEFAULT_SANDBOX_BASE_URL = "https://testpay.easebuzz.in"
DEFAULT_LIVE_BASE_URL = "https://pay.easebuzz.in"

_UDF_FIELDS = [f"udf{i}" for i in range(1, 11)]


def _sha512_lower(s: str) -> str:
    return hashlib.sha512(s.encode("utf-8")).hexdigest().lower()


def build_initiate_hash(payload: Dict[str, Any], salt: str) -> str:
    """`key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt`"""
    parts = [
        str(payload.get("key", "")),
        str(payload.get("txnid", "")),
        str(payload.get("amount", "")),
        str(payload.get("productinfo", "")),
        str(payload.get("firstname", "")),
        str(payload.get("email", "")),
    ]
    parts.extend(str(payload.get(k, "")) for k in _UDF_FIELDS)
    parts.append(salt)
    return _sha512_lower("|".join(parts))


def build_response_hash(data: Dict[str, Any], salt: str) -> str:
    """`salt|status|udf10..udf1|email|firstname|productinfo|amount|txnid|key`
    UDF order is REVERSED for response verification per Easebuzz spec."""
    parts = [
        salt,
        str(data.get("status", "")),
        str(data.get("udf10", "")),
        str(data.get("udf9", "")),
        str(data.get("udf8", "")),
        str(data.get("udf7", "")),
        str(data.get("udf6", "")),
        str(data.get("udf5", "")),
        str(data.get("udf4", "")),
        str(data.get("udf3", "")),
        str(data.get("udf2", "")),
        str(data.get("udf1", "")),
        str(data.get("email", "")),
        str(data.get("firstname", "")),
        str(data.get("productinfo", "")),
        str(data.get("amount", "")),
        str(data.get("txnid", "")),
        str(data.get("key", "")),
    ]
    return _sha512_lower("|".join(parts))


def build_retrieve_hash(payload: Dict[str, Any], salt: str) -> str:
    """`key|txnid|amount|email|phone|salt`"""
    parts = [
        str(payload.get("key", "")),
        str(payload.get("txnid", "")),
        str(payload.get("amount", "")),
        str(payload.get("email", "")),
        str(payload.get("phone", "")),
        salt,
    ]
    return _sha512_lower("|".join(parts))


def normalise_amount(amount: float | int | str) -> str:
    """Always send amount as a 2-decimal string. Same value must be used for
    the request-hash, the API call and the response-hash verification, else
    Easebuzz will silently mismatch."""
    return f"{float(amount):.2f}"


async def initiate_link(base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST form-urlencoded payload to `{base}/payment/initiateLink`."""
    url = base_url.rstrip("/") + "/payment/initiateLink"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            url,
            content=urlencode(payload),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    try:
        return r.json()
    except Exception:
        return {"status": 0, "raw": r.text}


async def retrieve_txn(base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """POST form-urlencoded payload to `{base}/transaction/v1/retrieve`."""
    url = base_url.rstrip("/") + "/transaction/v1/retrieve"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            url,
            content=urlencode(payload),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    try:
        return r.json()
    except Exception:
        return {"status": 0, "raw": r.text}


def default_settings_document() -> Dict[str, Any]:
    """Seed document used the first time the admin visits Payment Settings.
    Sandbox credentials come pre-filled (from the user's ask). Admin must
    populate the Live keys before flipping `environment` to `live`."""
    return {
        "_id": "active",
        "provider": "easebuzz",
        "enabled": True,
        "environment": "sandbox",
        "sandbox": {
            "key": "1OCWIXWTP",
            "salt": "ZPGNO0AHZ",
            "base_url": DEFAULT_SANDBOX_BASE_URL,
        },
        "live": {
            "key": "",
            "salt": "",
            "base_url": DEFAULT_LIVE_BASE_URL,
        },
        # Frontend routes the browser back to these after success/failure.
        # `{FRONTEND}` is substituted with REACT_APP_BACKEND_URL at runtime.
        "success_url": "/booking/payment-return",
        "failure_url": "/booking/payment-return",
        # Optional webhook override — leave blank to use default backend route.
        "webhook_url": "",
    }
