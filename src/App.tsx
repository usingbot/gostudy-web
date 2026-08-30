/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import Shop from './pages/Shop';
import StudyBoard from './pages/StudyBoard';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import AdminUserDetail from './pages/AdminUserDetail';
import GuildPublishing from './pages/GuildPublishing';
import PublicServers from './pages/PublicServers';
import PublicServerDetail from './pages/PublicServerDetail';
import PublicLayout from './components/PublicLayout';
import RequireAuth from './auth/RequireAuth';
import RequireAdmin from './auth/RequireAdmin';
import RequireGuildPublishing from './auth/RequireGuildPublishing';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/servers" element={<PublicServers />} />
          <Route path="/servers/:slug" element={<PublicServerDetail />} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        
        <Route element={<RequireAuth />}>
          {/* Authenticated Routes wrapped in Sidebar Layout */}
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/board" element={<StudyBoard />} />
            <Route path="/settings" element={<Settings />} />
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/users/:userid" element={<AdminUserDetail />} />
            </Route>
            <Route element={<RequireGuildPublishing />}>
              <Route path="/admin/servers" element={<GuildPublishing />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}
