import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const dashLink = user
    ? user.role === "admin" ? "/admin"
    : user.role === "artist" ? "/artist"
    : "/customer"
    : "/login";

  return (
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
              <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate("/"); }} data-testid="nav-logout">
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
