import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  // useCallback so the memoized context value below doesn't churn on every render.
  const login = useCallback(async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    localStorage.setItem("bt_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  }, []);

  const register = useCallback(async (data) => {
    const r = await api.post("/auth/register", data);
    localStorage.setItem("bt_token", r.data.token);
    setUser(r.data.user);
    return r.data.user;
  }, []);

  const logout = useCallback(() => {
    // Clear the httpOnly cookie server-side. Non-fatal if it fails (already
    // wiping localStorage below shuts down further auth actions).
    api.post("/auth/logout").catch(() => {});
    localStorage.removeItem("bt_token");
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
    } catch (e) {
      if (typeof console !== "undefined") console.warn("refreshMe failed:", e?.message || e);
    }
  }, []);

  // Memoise the context value so consumers only re-render when auth state
  // actually changes — not on every parent tick.
  const ctxValue = useMemo(
    () => ({ user, loading, login, register, logout, refreshMe, formatApiError }),
    [user, loading, login, register, logout, refreshMe],
  );

  return <AuthCtx.Provider value={ctxValue}>{children}</AuthCtx.Provider>;
};

export const useAuth = () => useContext(AuthCtx);
