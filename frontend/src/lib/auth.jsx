import React, { createContext, useContext, useEffect, useState } from "react";
import api, { formatApiError } from "./api";

const AuthCtx = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tok = localStorage.getItem("bt_token");
    if (!tok) { setLoading(false); return; }
    api.get("/auth/me").then((r) => setUser(r.data)).catch(() => {
      localStorage.removeItem("bt_token");
    }).finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    localStorage.setItem("bt_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  };

  const register = async (data) => {
    const r = await api.post("/auth/register", data);
    localStorage.setItem("bt_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = () => {
    // Clear the httpOnly cookie server-side. Non-fatal if it fails (already
    // wiping localStorage below shuts down further auth actions).
    api.post("/auth/logout").catch(() => {});
    localStorage.removeItem("bt_token");
    setUser(null);
  };

  const refreshMe = async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
    } catch (e) {
      // Non-fatal — network hiccup or expired token. Log for observability
      // but never surface to the user; the axios interceptor will 401-log-out
      // on the next authenticated call if the session is truly gone.
      if (typeof console !== "undefined") console.warn("refreshMe failed:", e?.message || e);
    }
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refreshMe, formatApiError }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
