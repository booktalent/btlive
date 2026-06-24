import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

const ROLES = [
  { value: "customer", icon: "🎉", name: "Customer", desc: "I want to book artists for my events" },
  { value: "artist", icon: "🎤", name: "Artist", desc: "I perform and want to get bookings" },
  { value: "agency", icon: "🏢", name: "Agency", desc: "I manage multiple artists" },
  { value: "corporate", icon: "💼", name: "Corporate", desc: "Bulk bookings for company events" },
];

export default function Auth({ mode = "signin" }) {
  const [params] = useSearchParams();
  const initialRole = params.get("role") || "customer";
  const { login, register, formatApiError } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [tab, setTab] = useState(mode === "signin" ? "signin" : "signup");
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    email: "", password: "", confirm: "",
    first_name: "", last_name: "", phone: "",
    role: initialRole, category: "", city: "", company_name: "",
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const doSignIn = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const u = await login(form.email, form.password);
      toast(`Welcome back, ${u.first_name}!`);
      const dest = u.role === "admin" ? "/admin" : u.role === "artist" ? "/artist" : "/customer";
      nav(dest);
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(false);
  };

  const doSignUp = async () => {
    if (form.password !== form.confirm) { toast("Passwords do not match", "error"); return; }
    if (form.password.length < 6) { toast("Password too short (min 6)", "error"); return; }
    setBusy(true);
    try {
      const payload = {
        email: form.email, password: form.password,
        first_name: form.first_name, last_name: form.last_name,
        phone: form.phone, role: form.role,
        category: form.category, city: form.city,
        company_name: form.company_name,
      };
      const u = await register(payload);
      toast(`Welcome to BookTalent, ${u.first_name}!`);
      const dest = u.role === "artist" ? "/artist" : u.role === "admin" ? "/admin" : "/customer";
      nav(dest);
    } catch (e) { toast(formatApiError(e), "error"); }
    setBusy(false);
  };

  return (
    <div className="auth-wrap" data-testid="auth-page">
      <div className="auth-left">
        <Link to="/" className="logo" data-testid="auth-logo">
          <div className="logo-mark">B</div>
          <span>Book<span className="gold">Talent</span></span>
        </Link>
        <div>
          <div className="hero-tag" style={{ marginBottom: 18 }}>India's #1 Talent Marketplace</div>
          <h1 style={{ fontFamily: "Cormorant Garamond, serif", fontSize: 52, fontWeight: 700, lineHeight: 1.1, marginBottom: 18 }}>
            Book India's<br/>
            <span style={{ background: "linear-gradient(135deg, var(--gold-light), var(--gold))", WebkitBackgroundClip: "text", color: "transparent" }}>Finest</span> Talent
          </h1>
          <p style={{ color: "var(--white-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 30 }}>
            Join 68,000+ event planners and artists on the most premium talent booking platform.
          </p>
          <div style={{ display: "flex", gap: 30 }}>
            <div><div className="hero-stat-num">5,200+</div><div className="hero-stat-label">Artists</div></div>
            <div><div className="hero-stat-num">48K+</div><div className="hero-stat-label">Events</div></div>
            <div><div className="hero-stat-num">32</div><div className="hero-stat-label">Cities</div></div>
          </div>
        </div>
        <div className="card card-pad" style={{ maxWidth: 340 }}>
          <div className="fs-13 mb-12" style={{ lineHeight: 1.6 }}>
            "BookTalent transformed how we book artists for our events. Transparent, fast and the contract system gives us complete peace of mind."
          </div>
          <div className="flex items-center gap-10">
            <div className="avatar" style={{ background: "linear-gradient(135deg, var(--gold), var(--purple))" }}>RK</div>
            <div>
              <div className="fw-600 fs-13">Rajesh Khanna</div>
              <div className="text-muted fs-11">Wedding Planner, Mumbai</div>
            </div>
            <span style={{ color: "var(--gold)", marginLeft: "auto" }}>★★★★★</span>
          </div>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-tabs" data-testid="auth-tabs">
          <button className={`auth-tab ${tab === "signin" ? "active" : ""}`} onClick={() => setTab("signin")} data-testid="tab-signin">Sign In</button>
          <button className={`auth-tab ${tab === "signup" ? "active" : ""}`} onClick={() => { setTab("signup"); setStep(1); }} data-testid="tab-signup">Create Account</button>
        </div>

        {tab === "signin" ? (
          <form onSubmit={doSignIn} data-testid="signin-form">
            <div className="auth-title">Welcome <span className="gold-grad" style={{ background: "linear-gradient(135deg, var(--gold-light), var(--gold))", WebkitBackgroundClip: "text", color: "transparent" }}>Back</span></div>
            <div className="auth-sub">Sign in to manage your bookings and events.</div>
            <div className="field">
              <div className="field-label">Email</div>
              <input className="field-input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" required data-testid="signin-email" />
            </div>
            <div className="field">
              <div className="field-label">Password</div>
              <input className="field-input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••" required data-testid="signin-password" />
            </div>
            <button type="submit" className="btn btn-gold btn-block" disabled={busy} data-testid="signin-submit">
              {busy ? "Signing in…" : "Sign In →"}
            </button>
            <div className="text-center mt-20 fs-13" style={{ color: "var(--white-muted)" }}>
              <strong style={{ color: "var(--gold-light)" }}>Demo:</strong>{" "}
              <span data-testid="demo-credentials">admin@booktalent.com / Admin@123</span>
              <br/>customer@booktalent.com / Customer@123
              <br/>priya@booktalent.com / Artist@123
            </div>
          </form>
        ) : (
          <div data-testid="signup-form">
            {step === 1 && (
              <>
                <div className="auth-title">I am <span className="gold-grad" style={{ background: "linear-gradient(135deg, var(--gold-light), var(--gold))", WebkitBackgroundClip: "text", color: "transparent" }}>a…</span></div>
                <div className="auth-sub">Select your role to get the right experience.</div>
                <div className="role-grid">
                  {ROLES.map((r) => (
                    <div key={r.value} className={`role-opt ${form.role === r.value ? "selected" : ""}`} onClick={() => set("role", r.value)} data-testid={`role-${r.value}`}>
                      <div className="role-ico">{r.icon}</div>
                      <div className="role-name">{r.name}</div>
                      <div className="role-desc">{r.desc}</div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-gold btn-block" onClick={() => setStep(2)} data-testid="signup-next-1">Continue →</button>
              </>
            )}
            {step === 2 && (
              <>
                <div className="auth-title">Your <span className="gold-grad" style={{ background: "linear-gradient(135deg, var(--gold-light), var(--gold))", WebkitBackgroundClip: "text", color: "transparent" }}>Details</span></div>
                <div className="auth-sub">Fill in your information to create your account.</div>
                <div className="field-row">
                  <div className="field">
                    <div className="field-label">First Name</div>
                    <input className="field-input" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} data-testid="signup-first-name" />
                  </div>
                  <div className="field">
                    <div className="field-label">Last Name</div>
                    <input className="field-input" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} data-testid="signup-last-name" />
                  </div>
                </div>
                <div className="field">
                  <div className="field-label">Email</div>
                  <input className="field-input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="signup-email" />
                </div>
                <div className="field">
                  <div className="field-label">Mobile</div>
                  <input className="field-input" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91 98765 43210" data-testid="signup-phone" />
                </div>
                {form.role === "artist" && (
                  <>
                    <div className="field">
                      <div className="field-label">Artist Category</div>
                      <select className="field-input" value={form.category} onChange={(e) => set("category", e.target.value)} data-testid="signup-category">
                        <option value="">Select your category…</option>
                        <option>Bollywood Vocalist</option>
                        <option>Classical Vocalist</option>
                        <option>DJ / Music Producer</option>
                        <option>Stand-up Comedian</option>
                        <option>Anchor / Emcee</option>
                        <option>Dancer / Troupe</option>
                        <option>Live Band</option>
                        <option>Magician</option>
                        <option>Folk Artist</option>
                      </select>
                    </div>
                    <div className="field">
                      <div className="field-label">Primary City</div>
                      <select className="field-input" value={form.city} onChange={(e) => set("city", e.target.value)} data-testid="signup-city">
                        <option value="">Select city…</option>
                        <option>Mumbai</option><option>Delhi NCR</option><option>Bangalore</option>
                        <option>Chennai</option><option>Hyderabad</option><option>Kolkata</option><option>Pune</option>
                      </select>
                    </div>
                  </>
                )}
                {(form.role === "agency" || form.role === "corporate") && (
                  <div className="field">
                    <div className="field-label">{form.role === "agency" ? "Agency Name" : "Company Name"}</div>
                    <input className="field-input" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} data-testid="signup-company" />
                  </div>
                )}
                <div className="field">
                  <div className="field-label">Create Password</div>
                  <input className="field-input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="Min 6 chars" data-testid="signup-password" />
                </div>
                <div className="field">
                  <div className="field-label">Confirm Password</div>
                  <input className="field-input" type="password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} data-testid="signup-confirm" />
                </div>
                <div className="flex gap-12">
                  <button className="btn btn-ghost" onClick={() => setStep(1)} data-testid="signup-back-1">← Back</button>
                  <button className="btn btn-gold" style={{ flex: 1 }} onClick={doSignUp} disabled={busy} data-testid="signup-submit">
                    {busy ? "Creating…" : "Create Account →"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
