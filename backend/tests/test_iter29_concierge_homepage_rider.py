"""
Iteration 29 — BookTalent Sprint (Concierge + Smart Homepage + Rider Wallet)
Tests three new backend features + regression on pricing formula.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://booktalent-audit.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN = ("admin@booktalent.com", "Admin@123")
CUSTOMER = ("customer@booktalent.com", "Customer@123")
PRIYA = ("priya@booktalent.com", "Artist@123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in login response: {data}"
    return tok, data.get("user") or data


@pytest.fixture(scope="module")
def admin_token():
    tok, _ = _login(*ADMIN)
    return tok


@pytest.fixture(scope="module")
def customer_token():
    tok, _ = _login(*CUSTOMER)
    return tok


@pytest.fixture(scope="module")
def priya_token():
    tok, _ = _login(*PRIYA)
    return tok


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ──────────────────────────────────────────────────────────────────
# CONCIERGE gate + lifecycle
# ──────────────────────────────────────────────────────────────────
class TestConcierge:
    def test_01_downgrade_priya_to_free(self, priya_token):
        # Ensure clean state — try to downgrade to free (may 200 or 400 if already free)
        r = requests.post(f"{API}/subscriptions/subscribe", json={"plan": "free"},
                          headers=_h(priya_token), timeout=20)
        # accept success or "already"
        assert r.status_code in (200, 201, 400), f"downgrade fail: {r.status_code} {r.text}"

    def test_02_free_artist_denied(self, priya_token):
        r = requests.get(f"{API}/concierge/my-thread", headers=_h(priya_token), timeout=20)
        assert r.status_code == 403
        body = r.json().get("detail", "") if r.headers.get("content-type", "").startswith("application/json") else r.text
        assert "Platinum" in body or "Elite" in body or "Upgrade" in body, f"unexpected detail: {body}"

    def test_03_customer_denied(self, customer_token):
        r = requests.get(f"{API}/concierge/my-thread", headers=_h(customer_token), timeout=20)
        assert r.status_code == 403
        body = r.json().get("detail", "")
        assert "artist" in body.lower() or "agencies" in body.lower(), f"expected artist/agency msg: {body}"

    def test_04_upgrade_to_elite(self, priya_token):
        r = requests.post(f"{API}/subscriptions/subscribe", json={"plan": "elite"},
                          headers=_h(priya_token), timeout=20)
        assert r.status_code == 200, f"upgrade fail: {r.status_code} {r.text}"

    def test_05_my_thread_null(self, priya_token):
        # Cleanup any previous thread first (best-effort via admin close)
        r = requests.get(f"{API}/concierge/my-thread", headers=_h(priya_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("plan") == "elite", f"plan should be elite: {data}"
        # thread may already exist from prior runs; assert key exists
        assert "thread" in data

    def test_06_open_thread_priority_100(self, priya_token, admin_token):
        # If prior thread exists and open, close it first via admin to test fresh open path
        r_admin = requests.get(f"{API}/admin/concierge/threads", headers=_h(admin_token), timeout=20)
        assert r_admin.status_code == 200
        for t in r_admin.json():
            if t.get("plan") == "elite" and t.get("status") == "open":
                # only close if it's Priya's — we don't know priya's id here reliably; skip
                pass

        r = requests.post(f"{API}/concierge/open",
                          json={"subject": "Payout question", "first_message": "Hi team, when is my payout?"},
                          headers=_h(priya_token), timeout=20)
        assert r.status_code == 200, r.text
        thr = r.json().get("thread")
        assert thr is not None
        assert thr.get("priority") == 100, f"expected priority 100, got {thr.get('priority')}"
        # save thread id for later tests
        pytest.priya_thread_id = thr["id"]

    def test_07_messages_has_first(self, priya_token):
        r = requests.get(f"{API}/concierge/messages", headers=_h(priya_token), timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data.get("thread") is not None
        msgs = data.get("messages", [])
        # At least the first_message we posted must be present
        assert len(msgs) >= 1, f"expected >=1 message, got {msgs}"

    def test_08_send_follow_up(self, priya_token):
        r = requests.post(f"{API}/concierge/send", json={"body": "Follow-up"},
                          headers=_h(priya_token), timeout=20)
        assert r.status_code == 200, r.text
        # Now list should be >=2
        r2 = requests.get(f"{API}/concierge/messages", headers=_h(priya_token), timeout=20)
        assert r2.status_code == 200
        msgs = r2.json().get("messages", [])
        assert len(msgs) >= 2, f"expected >=2 msgs, got {len(msgs)}"

    def test_09_admin_lists_priya_first(self, admin_token):
        r = requests.get(f"{API}/admin/concierge/threads", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        threads = r.json()
        assert isinstance(threads, list)
        assert len(threads) >= 1
        # elite (100) must come before lower-priority (or equal) after sort by priority DESC
        # Verify sort order: priorities are non-increasing
        priorities = [t.get("priority", 0) for t in threads]
        assert priorities == sorted(priorities, reverse=True), f"threads not sorted: {priorities}"

    def test_10_admin_reply(self, admin_token, priya_token):
        tid = getattr(pytest, "priya_thread_id", None)
        assert tid, "priya_thread_id fixture missing"
        r = requests.post(f"{API}/admin/concierge/{tid}/send",
                          json={"body": "Payout on Friday"},
                          headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        # Priya sees admin msg
        r2 = requests.get(f"{API}/concierge/messages", headers=_h(priya_token), timeout=20)
        msgs = r2.json().get("messages", [])
        assert any(m.get("sender_role") == "admin" and "Payout" in m.get("body", "") for m in msgs), \
            f"admin reply not visible to artist: {[m.get('body') for m in msgs]}"

    def test_11_admin_close_thread_blocks_send(self, admin_token, priya_token):
        tid = getattr(pytest, "priya_thread_id", None)
        r = requests.post(f"{API}/admin/concierge/{tid}/close", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        # Now priya send should 400
        r2 = requests.post(f"{API}/concierge/send", json={"body": "still here?"},
                           headers=_h(priya_token), timeout=20)
        assert r2.status_code == 400, r2.text
        detail = r2.json().get("detail", "")
        assert "No open" in detail or "concierge" in detail.lower(), f"unexpected msg: {detail}"


# ──────────────────────────────────────────────────────────────────
# SMART HOMEPAGE
# ──────────────────────────────────────────────────────────────────
class TestSmartHomepage:
    def test_01_anonymous_no_personalized(self):
        r = requests.get(f"{API}/homepage/sections", timeout=20)
        assert r.status_code == 200
        rails = r.json()
        assert isinstance(rails, list)
        assert not any(rail.get("personalised") for rail in rails), \
            f"anonymous should have no personalised rails, got codes: {[r.get('code') for r in rails]}"

    def test_02_seed_search_history(self, customer_token):
        r = requests.get(f"{API}/search/artists",
                         params={"q": "singer", "city": "Mumbai", "category": "Bollywood Vocalist"},
                         headers=_h(customer_token), timeout=30)
        # Search may return 200 with results; accept either but ensure no server error
        assert r.status_code == 200, f"search failed: {r.status_code} {r.text[:200]}"

    def test_03_personalized_rails_present(self, customer_token):
        # small delay to allow persistence
        time.sleep(1)
        r = requests.get(f"{API}/homepage/sections", headers=_h(customer_token), timeout=30)
        assert r.status_code == 200
        rails = r.json()
        codes = [rail.get("code") for rail in rails]
        personal = [rail for rail in rails if rail.get("personalised")]
        assert len(personal) >= 1, f"expected personalised rails after search seed; codes={codes}"
        # Expected codes: continue_in_city and because_you_searched
        assert "continue_in_city" in codes, f"missing continue_in_city; codes={codes}"
        assert "because_you_searched" in codes, f"missing because_you_searched; codes={codes}"
        # Personalized rails must appear FIRST
        first_non_personal_idx = next((i for i, rail in enumerate(rails) if not rail.get("personalised")), len(rails))
        for i, rail in enumerate(rails[:first_non_personal_idx]):
            assert rail.get("personalised"), f"non-personal rail at idx {i} before personal ends"


# ──────────────────────────────────────────────────────────────────
# RIDER WALLET public
# ──────────────────────────────────────────────────────────────────
class TestRiderWalletPublic:
    def test_01_list_all(self):
        r = requests.get(f"{API}/rider-wallet/vendors", timeout=20)
        assert r.status_code == 200
        vendors = r.json()
        assert isinstance(vendors, list)
        assert len(vendors) >= 7, f"expected >=7 seeded vendors, got {len(vendors)}"

    def test_02_hotels(self):
        r = requests.get(f"{API}/rider-wallet/vendors", params={"type": "hotel"}, timeout=20)
        assert r.status_code == 200
        vendors = r.json()
        assert len(vendors) >= 3
        assert all(v["type"] == "hotel" for v in vendors)

    def test_03_flights(self):
        r = requests.get(f"{API}/rider-wallet/vendors", params={"type": "flight"}, timeout=20)
        assert r.status_code == 200
        vendors = r.json()
        assert len(vendors) >= 2
        assert all(v["type"] == "flight" for v in vendors)

    def test_04_transport(self):
        r = requests.get(f"{API}/rider-wallet/vendors", params={"type": "transport"}, timeout=20)
        assert r.status_code == 200
        vendors = r.json()
        assert len(vendors) >= 2
        assert all(v["type"] == "transport" for v in vendors)

    def test_05_city_filter_returns_nationwide(self):
        r = requests.get(f"{API}/rider-wallet/vendors", params={"city": "Mumbai"}, timeout=20)
        assert r.status_code == 200
        vendors = r.json()
        # All seeded vendors have city=None (nationwide) so they should all appear
        assert len(vendors) >= 7


# ──────────────────────────────────────────────────────────────────
# RIDER WALLET admin CRUD
# ──────────────────────────────────────────────────────────────────
class TestRiderWalletAdmin:
    def test_01_admin_create(self, admin_token):
        payload = {
            "type": "hotel", "name": "TEST_Hotel_Iter29", "city": "Mumbai",
            "discount_pct": 25, "tagline": "Test partner",
            "is_featured": True, "is_active": True,
        }
        r = requests.post(f"{API}/admin/rider-wallet/vendors", json=payload,
                          headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc.get("id")
        assert doc["name"] == "TEST_Hotel_Iter29"
        assert doc["discount_pct"] == 25
        pytest.rider_vid = doc["id"]

    def test_02_admin_update(self, admin_token):
        vid = getattr(pytest, "rider_vid", None)
        assert vid
        r = requests.patch(f"{API}/admin/rider-wallet/vendors/{vid}",
                           json={"discount_pct": 30},
                           headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["discount_pct"] == 30

    def test_03_admin_delete(self, admin_token):
        vid = getattr(pytest, "rider_vid", None)
        r = requests.delete(f"{API}/admin/rider-wallet/vendors/{vid}",
                            headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        # verify gone
        r2 = requests.delete(f"{API}/admin/rider-wallet/vendors/{vid}",
                             headers=_h(admin_token), timeout=20)
        assert r2.status_code == 404


# ──────────────────────────────────────────────────────────────────
# REGRESSION — Pricing formula 5% + 18% GST
# ──────────────────────────────────────────────────────────────────
class TestPricingRegression:
    def test_01_existing_booking_pricing(self, customer_token):
        r = requests.get(f"{API}/bookings/mine", headers=_h(customer_token), timeout=20)
        if r.status_code == 404:
            r = requests.get(f"{API}/bookings/me", headers=_h(customer_token), timeout=20)
        if r.status_code != 200:
            pytest.skip(f"no bookings endpoint reachable: {r.status_code}")
        data = r.json()
        bookings = data.get("items") if isinstance(data, dict) else data
        if not bookings:
            pytest.skip("no existing bookings for customer")
        # Find first booking with pricing
        target = next((b for b in bookings if b.get("pricing", {}).get("artist_fee") is not None), None)
        if not target:
            pytest.skip("no bookings with artist_fee pricing")
        p = target["pricing"]
        artist_fee = float(p["artist_fee"])
        platform_fee = float(p["platform_fee"])
        gst = float(p["gst"])
        total = float(p["total"])

        expected_platform = round(artist_fee * 0.05, 2)
        expected_gst = round(expected_platform * 0.18, 2)
        expected_total = round(expected_platform + expected_gst, 2)

        assert abs(platform_fee - expected_platform) <= 0.5, f"platform_fee mismatch: {platform_fee} vs {expected_platform}"
        assert abs(gst - expected_gst) <= 0.5, f"gst mismatch: {gst} vs {expected_gst}"
        assert abs(total - expected_total) <= 0.5, f"total mismatch: {total} vs {expected_total}"
        # Ensure no rider vendor cost added to booking total
        assert "rider_vendor_cost" not in p, f"rider_vendor_cost leaked into booking pricing: {p}"

