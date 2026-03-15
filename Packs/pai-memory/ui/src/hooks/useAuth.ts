import { useState, useEffect, useCallback } from 'react';
import { engram } from '../lib/engram-client';

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const token = engram.getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await engram.me();
      setUser(data);
      setIsAuthenticated(true);
    } catch {
      engram.clearToken();
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(
    (token: string) => {
      engram.setToken(token);
      checkAuth();
    },
    [checkAuth]
  );

  const logout = useCallback(() => {
    engram.clearToken();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  return { isAuthenticated, user, loading, login, logout };
}
