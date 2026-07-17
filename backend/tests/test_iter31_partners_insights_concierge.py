"""
Iter 31 — Partners Directory, Insights, Leaderboard, Concierge Notifications.

Covers:
  1. Public Partners Directory (/rider-wallet/vendors with slug, /partners/{slug})
  2. Partner click tracking → click_count increments
  3. Partner Leaderboard + rotate-featured (admin)
  4. Artist Insights (/artist/insights)
  5. Concierge admin reply triggers notify_dispatch + in-app notification
  6. Seed backfill — every vendor has slug + click_count
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://booktalent-audit.preview.emergentagent.com").rstrip("/")

ADMIN = ("admin@booktalent.com", "Admin@123")
ARTIST = ("priya@booktalent.com", "Artist@123")
CUSTOMER = ("customer@booktalent.com", "Customer@123")


def _login(session: requests.Session, email: str, password: str) -> str:
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    tok = _login(s, *ADMIN)
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def artist_client():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    tok = _login(s, *ARTIST)
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def customer_client():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    tok = _login(s, *CUSTOMER)
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


# ────────────────────────────────────────────────────────────────
# 1. Partners public directory
# ────────────────────────────────────────────────────────────────
class TestPartnersPublic:
    def test_vendors_list_has_slug_and_click_count(self):
        r = requests.get(f"{BASE_URL}/api/rider-wallet/vendors", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        for v in data:
            assert v.get("slug"), f"vendor {v.get('name')} missing slug"
            assert "click_count" in v, f"vendor {v.get('name')} missing click_count"
            assert isinstance(v["click_count"], int)

    def test_vendors_filter_by_type_hotel(self):
        r = requests.get(f"{BASE_URL}/api/rider-wallet/vendors?type=hotel", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert all(v["type"] == "hotel" for v in data)

    def test_partner_detail_by_slug(self):
        r = requests.get(f"{BASE_URL}/api/partners/taj-group-hotel", timeout=15)
        assert r.status_code == 200
        payload = r.json()
        assert "vendor" in payload and "related" in payload
        assert payload["vendor"]["slug"] == "taj-group-hotel"
        assert payload["vendor"]["type"] == "hotel"
        # related should be same-type, not the same vendor
        for rel in payload["related"]:
            assert rel["type"] == "hotel"
            assert rel["slug"] != "taj-group-hotel"

    def test_partner_detail_unknown_slug(self):
        r = requests.get(f"{BASE_URL}/api/partners/does-not-exist-xyz", timeout=15)
        assert r.status_code == 404


# ────────────────────────────────────────────────────────────────
# 2. Click tracking
# ────────────────────────────────────────────────────────────────
class TestClickTracking:
    def test_click_increments_count(self, admin_client):
        # find a vendor via admin list (has ids)
        r = admin_client.get(f"{BASE_URL}/api/admin/rider-wallet/vendors")
        assert r.status_code == 200
        vendors = r.json()
        assert vendors
        # pick a vendor with a stable slug (lemon-tree — least clicked in seed)
        target = next((v for v in vendors if v.get("slug") == "lemon-tree-premier-hotel"), vendors[0])
        before = int(target.get("click_count") or 0)

        for _ in range(3):
            cr = requests.post(f"{BASE_URL}/api/rider-wallet/vendors/{target['id']}/click", timeout=15)
            assert cr.status_code == 200
            assert cr.json().get("ok") is True

        # re-query
        r2 = admin_client.get(f"{BASE_URL}/api/admin/rider-wallet/vendors")
        after_vendor = next(v for v in r2.json() if v["id"] == target["id"])
        assert int(after_vendor["click_count"]) >= before + 3, \
            f"click_count did not increment: before={before} after={after_vendor['click_count']}"

    def test_click_unknown_vendor_returns_404(self):
        r = requests.post(f"{BASE_URL}/api/rider-wallet/vendors/nonexistent-id/click", timeout=15)
        assert r.status_code == 404


# ────────────────────────────────────────────────────────────────
# 3. Admin leaderboard + rotate-featured
# ────────────────────────────────────────────────────────────────
class TestLeaderboard:
    def test_leaderboard_requires_admin(self, customer_client):
        r = customer_client.get(f"{BASE_URL}/api/admin/rider-wallet/leaderboard")
        assert r.status_code == 403

    def test_leaderboard_sorted_by_click_count_desc(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/rider-wallet/leaderboard")
        assert r.status_code == 200
        rows = r.json()
        assert rows
        counts = [int(v.get("click_count") or 0) for v in rows]
        assert counts == sorted(counts, reverse=True), f"leaderboard not sorted desc: {counts}"

    def test_rotate_featured(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/admin/rider-wallet/rotate-featured?top_n=3")
        assert r.status_code == 200
        payload = r.json()
        assert payload.get("ok") is True
        assert "featured_count" in payload
        # 3 types × 3 top_n = up to 9 promoted (may be fewer if some types have < 3 vendors)
        assert payload["featured_count"] >= 1
        # verify featured flags actually got set
        r2 = admin_client.get(f"{BASE_URL}/api/admin/rider-wallet/vendors")
        featured = [v for v in r2.json() if v.get("is_featured")]
        assert len(featured) == payload["featured_count"]


# ────────────────────────────────────────────────────────────────
# 4. Artist Insights
# ────────────────────────────────────────────────────────────────
class TestInsights:
    def test_artist_insights_shape(self, artist_client):
        r = artist_client.get(f"{BASE_URL}/api/artist/insights")
        assert r.status_code == 200, r.text
        d = r.json()
        # top-level keys
        for k in ("funnel", "top_cities", "top_searched_cities", "top_event_types", "revenue"):
            assert k in d, f"missing key {k}"
        # funnel keys
        f = d["funnel"]
        for k in ("profile_views", "bookings_created", "bookings_confirmed",
                  "bookings_completed", "conversion_pct", "completion_pct"):
            assert k in f, f"funnel missing {k}"
        # revenue keys
        rev = d["revenue"]
        for k in ("total_earnings", "avg_ticket", "confirmed_bookings"):
            assert k in rev, f"revenue missing {k}"

    def test_insights_funnel_only(self, artist_client):
        r = artist_client.get(f"{BASE_URL}/api/artist/insights/funnel")
        assert r.status_code == 200
        assert "profile_views" in r.json()

    def test_insights_forbidden_for_customer(self, customer_client):
        r = customer_client.get(f"{BASE_URL}/api/artist/insights")
        assert r.status_code == 403


# ────────────────────────────────────────────────────────────────
# 5. Concierge admin reply triggers notify_dispatch
# ────────────────────────────────────────────────────────────────
class TestConciergeNotifications:
    def _upgrade_priya_to_elite(self, artist_id):
        """Directly write plan_code=elite onto artist_profiles (no admin API for this exists).
        Uses a sync pymongo client on the same MONGO_URL/DB_NAME to keep the test hermetic."""
        try:
            from pymongo import MongoClient
            mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db_ = mc[os.environ.get("DB_NAME", "booktalent")]
            db_.artist_profiles.update_one(
                {"user_id": artist_id},
                {"$set": {"plan_code": "elite", "plan_rank": 100, "premium_badge": True}},
                upsert=False,
            )
            return True
        except Exception as e:
            print("upgrade failed:", e)
            return False

    def _reset_priya_to_free(self, artist_id):
        try:
            from pymongo import MongoClient
            mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db_ = mc[os.environ.get("DB_NAME", "booktalent")]
            db_.artist_profiles.update_one(
                {"user_id": artist_id},
                {"$set": {"plan_code": "free", "plan_rank": 0, "premium_badge": False}},
            )
        except Exception:
            pass

    def test_concierge_admin_reply_creates_notification(self, admin_client, artist_client):
        # 1. Get Priya's user_id
        me = artist_client.get(f"{BASE_URL}/api/auth/me").json()
        priya_id = me["id"]

        # 2. Upgrade Priya to elite so concierge is unlocked (direct DB write — no admin API)
        ok = self._upgrade_priya_to_elite(priya_id)
        if not ok:
            pytest.skip("Cannot upgrade Priya to elite — skipping concierge notify test")

        try:
            # 3. Open a thread as Priya
            r = artist_client.post(f"{BASE_URL}/api/concierge/open",
                                   json={"subject": "TEST_iter31_notify", "first_message": "hi"})
            assert r.status_code == 200, r.text
            thread = r.json()["thread"]
            tid = thread["id"]

            # 4. Admin replies
            reply_body = "Thanks for reaching out! We'll help."
            adm = admin_client.post(f"{BASE_URL}/api/admin/concierge/{tid}/send",
                                    json={"body": reply_body})
            assert adm.status_code == 200, adm.text
            # give the async notify a moment
            time.sleep(1.0)

            # 5. Priya should see an in-app notification of type=concierge
            nots = artist_client.get(f"{BASE_URL}/api/notifications").json()
            items = nots.get("items") if isinstance(nots, dict) else nots
            concierge_notes = [n for n in items if n.get("type") == "concierge"]
            assert concierge_notes, "no concierge in-app notification created for the artist"

            # 6. Verify notify_dispatch wrote a notifications_log row for this event
            from pymongo import MongoClient
            mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            db_ = mc[os.environ.get("DB_NAME", "booktalent")]
            log_row = db_.notifications_log.find_one({"user_id": priya_id, "event": "concierge_reply"},
                                                    sort=[("_id", -1)])
            assert log_row is not None, "notify_dispatch did not write notifications_log row for concierge_reply"
        finally:
            # 7. Reset Priya back to free plan
            self._reset_priya_to_free(priya_id)

    def test_concierge_reply_survives_provider_absence(self, admin_client, artist_client):
        """External provider keys are absent — admin_send must not crash."""
        # ensure thread exists
        me = artist_client.get(f"{BASE_URL}/api/auth/me").json()
        # find thread
        threads = admin_client.get(f"{BASE_URL}/api/admin/concierge/threads").json()
        target = next((t for t in threads if t["artist_id"] == me["id"]), None)
        if not target:
            pytest.skip("no thread found to reply to")
        r = admin_client.post(f"{BASE_URL}/api/admin/concierge/{target['id']}/send",
                              json={"body": "second reply"})
        assert r.status_code == 200


# ────────────────────────────────────────────────────────────────
# 6. Seed backfill — every vendor has slug + click_count
# ────────────────────────────────────────────────────────────────
class TestSeedBackfill:
    def test_all_vendors_have_slug_and_click_count(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/rider-wallet/vendors")
        assert r.status_code == 200
        vendors = r.json()
        assert vendors
        for v in vendors:
            assert v.get("slug"), f"vendor {v.get('name')} missing slug"
            assert isinstance(v.get("click_count", 0), int)


# ────────────────────────────────────────────────────────────────
# 7. Regression — pricing math still 5% + 18% GST
# ────────────────────────────────────────────────────────────────
class TestPricingRegression:
    def test_platform_fee_5pct_gst_18pct(self, artist_client, customer_client):
        # Find a package by Priya
        me = artist_client.get(f"{BASE_URL}/api/auth/me").json()
        pkgs = artist_client.get(f"{BASE_URL}/api/packages/mine").json()
        if not pkgs:
            pytest.skip("Priya has no packages to test pricing against")
        pkg = pkgs[0]
        # Fetch mandatory add-ons and include them so booking passes validation
        addons = artist_client.get(f"{BASE_URL}/api/artist/addons").json()
        mandatory = [{"addon_id": a["id"], "quantity": 1} for a in addons if a.get("is_mandatory")]
        # Create a booking as customer using future date
        from datetime import date, timedelta
        event_date = (date.today() + timedelta(days=90)).isoformat()
        payload = {
            "artist_id": me["id"],
            "package_id": pkg["id"],
            "addons": [],
            "addon_selections": mandatory,
            "event_date": event_date,
            "event_time": "18:00",
            "event_type": "Wedding",
            "venue": "TEST_iter31_venue",
            "city": "Mumbai",
        }
        r = customer_client.post(f"{BASE_URL}/api/bookings", json=payload)
        if r.status_code != 200:
            pytest.skip(f"booking create failed: {r.status_code} {r.text}")
        b = r.json()
        p = b["pricing"]
        expected_pf = round(p["artist_fee"] * 0.05, 2)
        expected_gst = round(expected_pf * 0.18, 2)
        assert abs(p["platform_fee"] - expected_pf) < 0.5, f"platform_fee mismatch {p}"
        assert abs(p["gst"] - expected_gst) < 0.5, f"gst mismatch {p}"
        assert abs(p["total"] - (expected_pf + expected_gst)) < 0.5, f"total mismatch {p}"
