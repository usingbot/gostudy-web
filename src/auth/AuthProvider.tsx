import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface AuthUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const currentUser = await fetchCurrentUser();
      setUser(currentUser);
      setStatus(currentUser ? 'authenticated' : 'unauthenticated');
    } catch {
      setUser(null);
      setStatus('error');
    }
  }, []);

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
  }, []);

  const value = useMemo(() => ({user, status, refresh, logout}), [user, status, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
