import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dashLink = user
    ? user.role === "admin" ? "/admin"
    : user.role === "artist" ? "/artist"
    : user.role === "agency" ? "/agency"
    : user.role === "corporate" ? "/corporate"
    : "/customer"
    : "/login";

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (drawerOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [drawerOpen]);

  const doLogout = () => { logout(); navigate("/"); };

  return (
    <>
      <nav className="nav" data-testid="main-nav">
        <div className="nav-inner">
          <Link to="/" className="logo" data-testid="logo-link">
            <div className="logo-mark">B</div>
            <span>Book<span className="gold">Talent</span></span>
          </Link>
          <div className="nav-links">
            <Link to="/" className="nav-link" data-testid="nav-home">Home</Link>
            <Link to="/search" className="nav-link" data-testid="nav-search">Discover Artists</Link>
            {user && <Link to={dashLink} className="nav-link" data-testid="nav-dashboard">Dashboard</Link>}
          </div>
          <div className="nav-actions">
            {!user ? (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm" data-testid="nav-signin">Sign In</Link>
                <Link to="/signup" className="btn btn-gold btn-sm" data-testid="nav-signup">Get Started</Link>
              </>
            ) : (
              <>
                <span className="text-muted fs-13" data-testid="nav-user-name">
                  Hi, {user.first_name}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={doLogout} data-testid="nav-logout">
                  Logout
                </button>
              </>
            )}
            <button
              className="mobile-nav-toggle"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              data-testid="mobile-nav-toggle"
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>☰</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer + scrim */}
      <div
        className={`mobile-nav-scrim ${drawerOpen ? "open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
        data-testid="mobile-nav-scrim"
      />
      <aside
        className={`mobile-nav-drawer ${drawerOpen ? "open" : ""}`}
        aria-hidden={!drawerOpen}
        data-testid="mobile-nav-drawer"
      >
        <button
          className="drawer-close"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          data-testid="mobile-nav-close"
        >×</button>
        <nav>
          <Link to="/" data-testid="drawer-home">Home</Link>
          <Link to="/search" data-testid="drawer-search">Discover Artists</Link>
          {user && <Link to={dashLink} data-testid="drawer-dashboard">Dashboard</Link>}
          {!user ? (
            <>
              <Link to="/login" data-testid="drawer-signin" style={{ marginTop: 12 }}>Sign In</Link>
              <Link to="/signup" data-testid="drawer-signup" style={{ background: "var(--gold)", color: "#000" }}>Get Started</Link>
            </>
          ) : (
            <button className="drawer-link" onClick={doLogout} data-testid="drawer-logout" style={{ textAlign: "left", background: "none", border: "1px solid transparent", color: "var(--white)", cursor: "pointer" }}>Logout</button>
          )}
        </nav>
      </aside>
    </>
  );
}
