import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {fetchAdminSelf} from '../api/admin';
import type {AdminSelf} from '../types';

export interface AuthUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
type AdminStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  admin: AdminSelf | null;
  adminStatus: AdminStatus;
  refresh: () => Promise<void>;
  refreshAdmin: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch('/api/me', {
    credentials: 'same-origin',
    headers: {Accept: 'application/json'},
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Unable to load the current session');
  }
  return response.json() as Promise<AuthUser>;
}

export function AuthProvider({children}: {children: ReactNode}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [admin, setAdmin] = useState<AdminSelf | null>(null);
  const [adminStatus, setAdminStatus] = useState<AdminStatus>('idle');

  const refreshAdmin = useCallback(async () => {
    setAdminStatus('loading');
    try {
      setAdmin(await fetchAdminSelf());
      setAdminStatus('ready');
    } catch {
      setAdmin(null);
      setAdminStatus('error');
    }
  }, []);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const currentUser = await fetchCurrentUser();
      setUser(currentUser);
      setStatus(currentUser ? 'authenticated' : 'unauthenticated');
      if (currentUser) {
        await refreshAdmin();
      } else {
        setAdmin(null);
        setAdminStatus('idle');
      }
    } catch {
      setUser(null);
      setStatus('error');
      setAdmin(null);
      setAdminStatus('idle');
    }
  }, [refreshAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    const response = await fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {Accept: 'application/json'},
    });
    if (!response.ok) {
      throw new Error('Unable to log out');
    }
    setUser(null);
    setStatus('unauthenticated');
    setAdmin(null);
    setAdminStatus('idle');
  }, []);

  const value = useMemo(() => ({
    user,
    status,
    admin,
    adminStatus,
    refresh,
    refreshAdmin,
    logout,
  }), [user, status, admin, adminStatus, refresh, refreshAdmin, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
