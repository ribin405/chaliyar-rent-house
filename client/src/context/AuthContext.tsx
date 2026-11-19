import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest, setAuthToken, getAuthToken, isTokenExpired, SESSION_EXPIRED_EVENT } from '../lib/api';
import type { User } from '../types';

const USER_STORAGE_KEY = 'rentalERP.user';

interface LoginResult {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  // True when the user was sent to the login page because their sign-in ran out.
  sessionExpired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const clearSession = () => {
    setAuthToken(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  };

  useEffect(() => {
    const token = getAuthToken();
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (token && isTokenExpired(token)) {
      // An old tab or phone that was left closed overnight: go straight to login
      // rather than showing pages that can only fail.
      clearSession();
      setSessionExpired(true);
    } else if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        setAuthToken(null);
      }
    }
    setLoading(false);
  }, []);

  // The API layer fires this when the server rejects our token mid-session.
  useEffect(() => {
    const handleExpired = () => {
      clearSession();
      setSessionExpired(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, []);

  const login = async (username: string, password: string) => {
    const result = await apiRequest<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setAuthToken(result.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
    setSessionExpired(false);
    setUser(result.user);
  };

  const logout = () => {
    clearSession();
    setSessionExpired(false);
  };

  return <AuthContext.Provider value={{ user, loading, sessionExpired, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
