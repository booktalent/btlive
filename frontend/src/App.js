import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";

import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Search from "./pages/Search";
import ArtistProfile from "./pages/ArtistProfile";
import BookingFlow from "./pages/BookingFlow";
import CustomerDashboard from "./pages/CustomerDashboard";
import ArtistDashboard from "./pages/ArtistDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import { AgencyDashboard, CorporateDashboard } from "./pages/RoleDashboards";
import NotFound from "./pages/NotFound";

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Auth mode="signin" />} />
              <Route path="/signup" element={<Auth mode="signup" />} />
              <Route path="/search" element={<Search />} />
              <Route path="/artist/:id" element={<ArtistProfile />} />
              <Route path="/book/:id" element={<Protected><BookingFlow /></Protected>} />
              <Route path="/customer" element={<Protected roles={["customer"]}><CustomerDashboard /></Protected>} />
              <Route path="/artist" element={<Protected roles={["artist"]}><ArtistDashboard /></Protected>} />
              <Route path="/agency" element={<Protected roles={["agency"]}><AgencyDashboard /></Protected>} />
              <Route path="/corporate" element={<Protected roles={["corporate"]}><CorporateDashboard /></Protected>} />
              <Route path="/admin" element={<Protected roles={["admin"]}><AdminDashboard /></Protected>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
