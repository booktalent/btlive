import React from "react";
import "./App.css";
import "./styles/iter39.css";
import "./styles/iter42.css";
import "./styles/iter43.css";
import "./styles/iter44.css";
import "./styles/iter45.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import Announcements from "./components/Announcements";

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
import CmsPage from "./pages/CmsPage";
import HelpCenter from "./pages/HelpCenter";
import CategoryLanding from "./pages/CategoryLanding";
import CityLanding from "./pages/CityLanding";
import BlogList from "./pages/BlogList";
import BlogArticle from "./pages/BlogArticle";

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

// Role guards — hoisted as module constants so identity is stable and
// `Protected` doesn't see a new prop reference on every parent render.
const ROLES_CUSTOMER = ["customer"];
const ROLES_ARTIST = ["artist"];
const ROLES_AGENCY = ["agency"];
const ROLES_CORPORATE = ["corporate"];
const ROLES_ADMIN = ["admin"];

function App() {
  return (
    <div className="App">
      <HelmetProvider>
        <BrowserRouter>
          <AuthProvider>
            <ToastProvider>
              <Announcements />
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Auth mode="signin" />} />
                <Route path="/signup" element={<Auth mode="signup" />} />
                <Route path="/search" element={<Search />} />

                {/* SEO-friendly public pages */}
                <Route path="/artist/:id" element={<ArtistProfile />} />
                <Route path="/page/:slug" element={<CmsPage />} />
                <Route path="/help" element={<HelpCenter />} />
                <Route path="/artists/city/:slug" element={<CityLanding />} />
                <Route path="/artists/:slug" element={<CategoryLanding />} />
                <Route path="/blog" element={<BlogList />} />
                <Route path="/blog/:slug" element={<BlogArticle />} />

                <Route path="/book/:id" element={<Protected><BookingFlow /></Protected>} />
                <Route path="/customer" element={<Protected roles={ROLES_CUSTOMER}><CustomerDashboard /></Protected>} />
                <Route path="/artist" element={<Protected roles={ROLES_ARTIST}><ArtistDashboard /></Protected>} />
                <Route path="/agency" element={<Protected roles={ROLES_AGENCY}><AgencyDashboard /></Protected>} />
                <Route path="/corporate" element={<Protected roles={ROLES_CORPORATE}><CorporateDashboard /></Protected>} />
                <Route path="/admin" element={<Protected roles={ROLES_ADMIN}><AdminDashboard /></Protected>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </HelmetProvider>
    </div>
  );
}

export default App;
