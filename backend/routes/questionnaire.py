"""
Dynamic Artist Onboarding Questionnaire.

Layer 1: universal questions asked of every artist.
Layer 2: category-specific questions asked in addition, based on the artist's
         chosen category (Singer, DJ, Comedian, Dancer, etc.).

Everything is metadata-driven so admins can add / edit questions from the
Admin panel without touching code. Answers live on `artist_profiles.answers`
as a `{ question_id: answer_value }` map.

This module ships the **read** side + seed. The dynamic renderer and admin
form-builder UI arrive in a follow-up.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, Any
from pydantic import BaseModel


UNIVERSAL_QUESTIONS = [
    # ── Layer 1 · Section: Identity ──
    {"section": "Identity", "id": "stage_name", "label": "Stage / Performer name", "type": "text", "required": True, "order": 10},
    {"section": "Identity", "id": "legal_name", "label": "Legal name (for contracts)", "type": "text", "required": True, "order": 20},
    {"section": "Identity", "id": "primary_language", "label": "Primary language of performance", "type": "select", "options": ["Hindi", "English", "Punjabi", "Marathi", "Tamil", "Telugu", "Bengali", "Kannada", "Malayalam", "Other"], "required": True, "order": 30},
    {"section": "Identity", "id": "secondary_languages", "label": "Other languages you perform in", "type": "multiselect", "options": ["Hindi", "English", "Punjabi", "Marathi", "Tamil", "Telugu", "Bengali", "Kannada", "Malayalam", "Gujarati", "Rajasthani"], "order": 40},

    # ── Layer 1 · Section: Contact ──
    {"section": "Contact", "id": "phone_primary", "label": "Primary phone (WhatsApp)", "type": "tel", "required": True, "order": 60},
    {"section": "Contact", "id": "manager_name", "label": "Manager or point-of-contact name", "type": "text", "order": 70},
    {"section": "Contact", "id": "manager_phone", "label": "Manager phone", "type": "tel", "order": 80},
    {"section": "Contact", "id": "based_city", "label": "City you are based in", "type": "text", "required": True, "order": 90},
    {"section": "Contact", "id": "travel_radius_km", "label": "Willing to travel up to (km)", "type": "number", "required": True, "order": 100},

    # ── Layer 1 · Section: Experience ──
    {"section": "Experience", "id": "years_experience", "label": "Years of performing experience", "type": "number", "required": True, "order": 110},
    {"section": "Experience", "id": "shows_per_year", "label": "Approx. shows per year", "type": "number", "order": 120},
    {"section": "Experience", "id": "biggest_venue", "label": "Biggest venue / crowd you've performed for", "type": "text", "order": 130},
    {"section": "Experience", "id": "notable_clients", "label": "Notable past clients / weddings / brands", "type": "textarea", "order": 140},

    # ── Layer 1 · Section: Availability & Travel ──
    {"section": "Availability", "id": "weekly_off", "label": "Weekly off days (if any)", "type": "multiselect", "options": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], "order": 150},
    {"section": "Availability", "id": "advance_notice_days", "label": "Minimum advance notice required (days)", "type": "number", "required": True, "order": 160},
    {"section": "Availability", "id": "outstation_ok", "label": "Available for outstation bookings?", "type": "boolean", "order": 170},

    # ── Layer 1 · Section: Technical & Logistics ──
    {"section": "Technical", "id": "own_equipment", "label": "Bring your own equipment?", "type": "select", "options": ["Yes, full setup", "Partial - I'll list below", "No, venue provides"], "order": 180},
    {"section": "Technical", "id": "equipment_details", "label": "Equipment you bring (if partial)", "type": "textarea", "order": 190},
    {"section": "Technical", "id": "green_room", "label": "Green room requirement?", "type": "boolean", "order": 200},
    {"section": "Technical", "id": "meal_pref", "label": "Meal preference on-site", "type": "select", "options": ["Veg", "Non-veg", "Vegan", "Any"], "order": 210},

    # ── Layer 1 · Section: Pricing ──
    {"section": "Pricing", "id": "base_fee", "label": "Base fee per performance (INR)", "type": "number", "required": True, "order": 220},
    {"section": "Pricing", "id": "weekend_multiplier", "label": "Weekend rate multiplier", "type": "number", "step": 0.1, "order": 230},
    {"section": "Pricing", "id": "festival_multiplier", "label": "Festival / peak-season multiplier", "type": "number", "step": 0.1, "order": 240},
    {"section": "Pricing", "id": "outstation_surcharge", "label": "Outstation surcharge (INR flat)", "type": "number", "order": 250},

    # ── Layer 1 · Section: Legal & Compliance ──
    {"section": "Legal", "id": "pan_number", "label": "PAN number", "type": "text", "required": True, "order": 260},
    {"section": "Legal", "id": "gst_registered", "label": "Registered for GST?", "type": "boolean", "order": 270},
    {"section": "Legal", "id": "gst_number", "label": "GSTIN (if registered)", "type": "text", "order": 280},
    {"section": "Legal", "id": "invoice_currency", "label": "Invoice currency", "type": "select", "options": ["INR", "USD", "GBP"], "default": "INR", "order": 290},

    # ── Layer 1 · Section: Professional profile ──
    {"section": "Profile", "id": "bio_short", "label": "One-line bio (max 120 chars)", "type": "text", "required": True, "order": 300},
    {"section": "Profile", "id": "bio_long", "label": "Full bio", "type": "textarea", "required": True, "order": 310},
    {"section": "Profile", "id": "youtube_link", "label": "YouTube channel / demo reel URL", "type": "url", "order": 320},
    {"section": "Profile", "id": "instagram_handle", "label": "Instagram handle", "type": "text", "order": 330},
]

# ── Layer 2 · Category-specific questionnaires ──
# Categories map to the same slugs used in the frontend CATEGORIES list.
CATEGORY_QUESTIONS = {
    "Bollywood Vocalist": [
        {"id": "vocal_range", "label": "Vocal range (e.g. G2–C5)", "type": "text", "order": 10},
        {"id": "song_bank_size", "label": "Approx. number of songs in repertoire", "type": "number", "order": 20},
        {"id": "signature_songs", "label": "3 signature songs (comma-separated)", "type": "text", "order": 30},
        {"id": "live_musicians", "label": "Perform with live band?", "type": "select", "options": ["Solo w/ track", "With musicians", "Both"], "order": 40},
        {"id": "duet_ok", "label": "Available for duets / collaborations?", "type": "boolean", "order": 50},
    ],
    "Classical Vocalist": [
        {"id": "gharana", "label": "Gharana / tradition", "type": "text", "order": 10},
        {"id": "guru_lineage", "label": "Guru / lineage", "type": "text", "order": 20},
        {"id": "raga_specialties", "label": "Signature ragas", "type": "textarea", "order": 30},
        {"id": "concert_length_min", "label": "Typical concert length (minutes)", "type": "number", "order": 40},
    ],
    "DJ / Music Producer": [
        {"id": "genres", "label": "Genres you spin", "type": "multiselect", "options": ["House", "Tech-house", "Progressive", "Bollywood", "Punjabi", "EDM Mainstage", "Hip-hop", "R&B", "Deep House", "Techno"], "order": 10},
        {"id": "cdj_setup", "label": "CDJ / controller you use", "type": "text", "order": 20},
        {"id": "own_cdjs", "label": "Own CDJs / mixer?", "type": "boolean", "order": 30},
        {"id": "max_set_hours", "label": "Max continuous set length (hours)", "type": "number", "order": 40},
        {"id": "mc_hype", "label": "MC / hype during set?", "type": "boolean", "order": 50},
    ],
    "Stand-up Comedian": [
        {"id": "content_type", "label": "Style", "type": "select", "options": ["Clean corporate", "Observational", "Political", "Roast", "Improv", "Storytelling"], "order": 10},
        {"id": "duration_options", "label": "Sets you can deliver", "type": "multiselect", "options": ["15 min", "30 min", "45 min", "60 min", "90 min"], "order": 20},
        {"id": "language_mix", "label": "Hindi / English / Hinglish mix (%)", "type": "text", "order": 30},
        {"id": "corporate_ok", "label": "Comfortable with corporate audiences?", "type": "boolean", "order": 40},
    ],
    "Anchor / Emcee": [
        {"id": "event_types_hosted", "label": "Event types you host", "type": "multiselect", "options": ["Weddings","Sangeet","Corporate","Awards","Product Launch","Concerts","Festivals","Kids"], "order": 10},
        {"id": "bilingual", "label": "Bilingual / multilingual?", "type": "boolean", "order": 20},
        {"id": "shayari_ok", "label": "Include shayari / anchoring script?", "type": "boolean", "order": 30},
        {"id": "improv_games", "label": "Anchor games / improv?", "type": "boolean", "order": 40},
    ],
    "Dancer / Troupe": [
        {"id": "styles", "label": "Dance styles", "type": "multiselect", "options": ["Bollywood","Bharatnatyam","Kathak","Contemporary","Hip-hop","Salsa","Bhangra","Garba","Folk"], "order": 10},
        {"id": "troupe_size", "label": "Troupe size (number of dancers)", "type": "number", "order": 20},
        {"id": "choreography_ok", "label": "Choreograph custom pieces?", "type": "boolean", "order": 30},
        {"id": "costume_included", "label": "Costumes included in fee?", "type": "boolean", "order": 40},
    ],
    "Live Band": [
        {"id": "band_size", "label": "Number of musicians", "type": "number", "order": 10},
        {"id": "instruments", "label": "Instruments on stage", "type": "multiselect", "options": ["Vocals","Guitar","Bass","Drums","Keyboard","Tabla","Sax","Dhol","Percussion","Violin"], "order": 20},
        {"id": "genres_band", "label": "Genres", "type": "multiselect", "options": ["Bollywood retro","Bollywood current","Rock","Sufi","Jazz","Fusion","Folk","Ghazal"], "order": 30},
        {"id": "sound_engineer", "label": "Bring own sound engineer?", "type": "boolean", "order": 40},
    ],
    "Magician": [
        {"id": "act_types", "label": "Act types", "type": "multiselect", "options": ["Close-up","Stage illusion","Mentalism","Kids","Comedy magic"], "order": 10},
        {"id": "walk_around_ok", "label": "Do walk-around / cocktail-hour magic?", "type": "boolean", "order": 20},
        {"id": "max_audience", "label": "Max audience size", "type": "number", "order": 30},
    ],
    "Folk Artist": [
        {"id": "folk_form", "label": "Folk form (e.g. Rajasthani, Baul, Lavani)", "type": "text", "order": 10},
        {"id": "troupe_size_folk", "label": "Troupe size", "type": "number", "order": 20},
        {"id": "traditional_costume", "label": "Traditional costume included?", "type": "boolean", "order": 30},
    ],
}


class AnswerBody(BaseModel):
    """Answers coming in from the artist onboarding wizard."""
    answers: dict[str, Any]


def make_router(*, get_current_user, admin_only, db, clean, utcnow, **_):
    r = APIRouter()

    @r.get("/questionnaire/universal")
    async def get_universal():
        """Public read of Layer 1 questions. Prefers DB overrides if seeded."""
        # If admin has stored a customised version, return it; else return defaults.
        override = await db.questionnaire_meta.find_one({"id": "universal"})
        if override and override.get("questions"):
            return sorted(override["questions"], key=lambda q: q.get("order", 999))
        return UNIVERSAL_QUESTIONS

    @r.get("/questionnaire/category/{slug}")
    async def get_category(slug: str):
        """Public read of Layer 2 questions for a specific category slug."""
        override = await db.questionnaire_meta.find_one({"id": f"cat:{slug}"})
        if override and override.get("questions"):
            return sorted(override["questions"], key=lambda q: q.get("order", 999))
        return CATEGORY_QUESTIONS.get(slug, [])

    @r.get("/questionnaire/categories")
    async def list_categories():
        """List every category with an available Layer 2 questionnaire."""
        db_ids = set()
        async for m in db.questionnaire_meta.find({"id": {"$regex": "^cat:"}}):
            db_ids.add(m["id"].split(":", 1)[1])
        return sorted(list(set(CATEGORY_QUESTIONS.keys()) | db_ids))

    @r.post("/questionnaire/answers")
    async def submit_answers(body: AnswerBody, user: dict = Depends(get_current_user)):
        """Artist submits (partial) answers — merged into their profile.answers."""
        if user["role"] != "artist":
            raise HTTPException(403, "Artist only")
        await db.artist_profiles.update_one(
            {"user_id": user["id"]},
            {"$set": {**{f"answers.{k}": v for k, v in body.answers.items()},
                       "answers_updated_at": utcnow()}},
        )
        return {"ok": True, "saved_keys": list(body.answers.keys())}

    @r.get("/questionnaire/answers/mine")
    async def my_answers(user: dict = Depends(get_current_user)):
        if user["role"] != "artist":
            raise HTTPException(403, "Artist only")
        prof = await db.artist_profiles.find_one({"user_id": user["id"]}) or {}
        return prof.get("answers", {})

    # ── Admin CRUD for question metadata (rename/reorder/add/remove) ─────
    class _MetaBody(BaseModel):
        questions: list[dict]

    @r.put("/admin/questionnaire/universal")
    async def admin_set_universal(body: _MetaBody, _: dict = Depends(admin_only)):
        await db.questionnaire_meta.update_one(
            {"id": "universal"},
            {"$set": {"id": "universal", "questions": body.questions, "updated_at": utcnow()}},
            upsert=True,
        )
        return {"ok": True, "count": len(body.questions)}

    @r.put("/admin/questionnaire/category/{slug}")
    async def admin_set_category(slug: str, body: _MetaBody, _: dict = Depends(admin_only)):
        await db.questionnaire_meta.update_one(
            {"id": f"cat:{slug}"},
            {"$set": {"id": f"cat:{slug}", "slug": slug, "questions": body.questions, "updated_at": utcnow()}},
            upsert=True,
        )
        return {"ok": True, "count": len(body.questions)}

    return r
