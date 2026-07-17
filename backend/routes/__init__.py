"""
BookTalent — per-domain route modules.

Each module exports a `make_xxx_router(**deps) -> APIRouter` factory so that
shared helpers (db, get_current_user, admin_only, utility functions defined in
server.py) can be injected without circular imports.

Mount order in server.py:
    api.include_router(routes.reviews.make_router(...))
    api.include_router(routes.wallet.make_router(...))
    ...

This split was introduced in Iter 13 to break the monolithic server.py
(~2.8k lines) into smaller, domain-focused files for production maintenance.
"""
from . import reviews, wallet, coupons, blogs, disputes, kyc, uploads, addons

__all__ = ["reviews", "wallet", "coupons", "blogs", "disputes", "kyc", "uploads", "addons"]
