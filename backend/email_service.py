"""
Email service — sends transactional emails via Resend.
Falls back to console-log when RESEND_API_KEY is empty (test mode).
"""
import os
import asyncio
import logging
import secrets
from typing import Optional

log = logging.getLogger("booktalent.email")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "BookTalent <onboarding@resend.dev>").strip()
RESEND_ENABLED = bool(RESEND_API_KEY)

if RESEND_ENABLED:
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        log.info("Resend configured (sender=%s)", SENDER_EMAIL)
    except Exception as e:
        log.error("Resend init failed: %s", e)
        RESEND_ENABLED = False


def is_email_enabled() -> bool:
    return RESEND_ENABLED


def generate_otp() -> str:
    """6-digit numeric OTP.

    Uses the ``secrets`` module (cryptographically secure) rather than ``random``
    to avoid predictable OTPs. In mock mode we still return the deterministic
    ``123456`` so local tests and E2E automation stay reproducible.
    """
    if not RESEND_ENABLED:
        return "123456"
    return f"{secrets.randbelow(900000) + 100000}"


def _otp_html(name: str, otp: str) -> str:
    """Premium dark-luxury OTP email template using inline CSS + tables."""
    return f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#09090F;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#F0EEFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090F;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#0F0F1B;border:1px solid rgba(255,255,255,0.08);border-radius:18px;overflow:hidden;">
        <tr><td style="padding:32px 40px 16px;">
          <div style="display:inline-block;font-family:'Times New Roman',serif;font-size:24px;font-weight:700;color:#F0EEFF;">
            Book<span style="color:#D4AF37;">Talent</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 40px;">
          <div style="height:1px;background:linear-gradient(to right,transparent,#D4AF37,transparent);"></div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <div style="font-family:'Times New Roman',serif;font-size:28px;font-weight:700;color:#F0EEFF;line-height:1.2;margin-bottom:10px;">
            Verify your <span style="color:#D4AF37;">email</span>
          </div>
          <p style="font-size:14px;color:rgba(240,238,255,0.6);line-height:1.6;margin:0 0 24px;">
            Hi {name or 'there'}, welcome to BookTalent — India's #1 talent marketplace. Please use the verification code below to activate your account. This code expires in <b>10 minutes</b>.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td align="center" style="background:linear-gradient(135deg,rgba(212,175,55,0.12),rgba(109,40,217,0.08));border:1px solid rgba(212,175,55,0.3);border-radius:14px;padding:24px;">
              <div style="font-size:11px;color:rgba(240,238,255,0.5);letter-spacing:2px;margin-bottom:10px;">VERIFICATION CODE</div>
              <div style="font-family:'Courier New',monospace;font-size:38px;font-weight:700;color:#F1D17A;letter-spacing:10px;">{otp}</div>
            </td></tr>
          </table>
          <p style="font-size:13px;color:rgba(240,238,255,0.6);line-height:1.6;margin:18px 0 0;">
            If you didn't request this code, you can safely ignore this email — your account remains secure.
          </p>
        </td></tr>
        <tr><td style="padding:0 40px 28px;">
          <div style="height:1px;background:rgba(255,255,255,0.08);margin:16px 0;"></div>
          <p style="font-size:11px;color:rgba(240,238,255,0.4);margin:0;text-align:center;">
            © 2026 BookTalent · India's Premium Talent Marketplace
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


async def send_otp_email(to_email: str, otp: str, name: str = "") -> dict:
    """Send an OTP email. Returns {sent, mock, error?}."""
    if not RESEND_ENABLED:
        log.info("📧 [MOCK email] to=%s name=%s otp=%s", to_email, name, otp)
        return {"sent": True, "mock": True}

    import resend
    params = {
        "from": SENDER_EMAIL,
        "to": [to_email],
        "subject": f"Your BookTalent verification code: {otp}",
        "html": _otp_html(name, otp),
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        log.info("Resend OK id=%s to=%s", result.get("id"), to_email)
        return {"sent": True, "mock": False, "id": result.get("id")}
    except Exception as e:
        log.error("Resend failed: %s", e)
        return {"sent": False, "mock": False, "error": str(e)}


async def send_booking_confirmation_email(to_email: str, name: str, booking_ref: str, artist_name: str, event_date: str) -> dict:
    if not RESEND_ENABLED:
        log.info("📧 [MOCK booking-email] to=%s booking=%s", to_email, booking_ref)
        return {"sent": True, "mock": True}
    import resend
    html = f"""<!doctype html><html><body style="margin:0;padding:0;background:#09090F;font-family:-apple-system,sans-serif;color:#F0EEFF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090F;padding:32px 0;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#0F0F1B;border:1px solid rgba(255,255,255,0.08);border-radius:18px;">
      <tr><td style="padding:36px;">
        <div style="font-family:'Times New Roman',serif;font-size:22px;font-weight:700;color:#F0EEFF;margin-bottom:18px;">Book<span style="color:#D4AF37;">Talent</span></div>
        <h2 style="font-family:'Times New Roman',serif;font-size:28px;color:#F0EEFF;margin:0 0 8px;">Booking <span style="color:#D4AF37;">Confirmed</span> ✨</h2>
        <p style="color:rgba(240,238,255,0.7);font-size:14px;line-height:1.6;">Hi {name}, your booking with <b>{artist_name}</b> on <b>{event_date}</b> is confirmed.</p>
        <p style="color:rgba(240,238,255,0.7);font-size:14px;">Booking Reference: <code style="color:#F1D17A;background:rgba(212,175,55,0.12);padding:3px 9px;border-radius:6px;">{booking_ref}</code></p>
      </td></tr>
    </table></td></tr></table></body></html>"""
    try:
        result = await asyncio.to_thread(resend.Emails.send, {
            "from": SENDER_EMAIL, "to": [to_email],
            "subject": f"Booking Confirmed — {booking_ref}", "html": html,
        })
        return {"sent": True, "mock": False, "id": result.get("id")}
    except Exception as e:
        return {"sent": False, "mock": False, "error": str(e)}
