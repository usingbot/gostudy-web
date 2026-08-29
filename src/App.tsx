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
import RequireAuth from './auth/RequireAuth';
import RequireAdmin from './auth/RequireAdmin';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
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
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}
