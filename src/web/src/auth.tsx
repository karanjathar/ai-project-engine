import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, AUTH_EXPIRED_EVENT, getToken, setToken } from './api/client';
import type { Role, User } from './api/types';

const RANK: Record<Role, number> = { viewer: 1, staff: 2, admin: 3 };

interface AuthState {
  user: User | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): void;
  /** True when the signed-in user has at least this role. */
  can(role: Role): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api<User>('/auth/me').then(setUser, () => setToken(null)).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => { setToken(null); setUser(null); }, []);
  const can = useCallback((role: Role) => (user ? RANK[user.role] >= RANK[role] : false), [user]);

  const value = useMemo(() => ({ user, ready, login, logout, can }), [user, ready, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
