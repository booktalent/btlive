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
    localStorage.removeItem("bt_token");
    setUser(null);
  };

  const refreshMe = async () => {
    try {
      const r = await api.get("/auth/me");
      setUser(r.data);
    } catch (e) { /* ignore */ }
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refreshMe, formatApiError }}>
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => useContext(AuthCtx);
