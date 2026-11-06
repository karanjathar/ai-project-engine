import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { SettingsProvider } from './settings';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Products } from './pages/Products';
import { Inventory } from './pages/Inventory';
import { Movements } from './pages/Movements';
import { Customers, Suppliers, Warehouses } from './pages/Parties';
import type { Role } from './api/types';

function RequireAuth({ children, role = 'viewer' }: { children: ReactNode; role?: Role }) {
  const { user, ready, can } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!can(role)) return <div className="center">You do not have access to this page.</div>;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><SettingsProvider><Layout /></SettingsProvider></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="movements" element={<Movements />} />
        <Route path="warehouses" element={<Warehouses />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="customers" element={<Customers />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
