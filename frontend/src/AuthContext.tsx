import { createContext, useContext, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { identifyTenant, resetTracking } from './posthog';

interface User {
  username: string;
  companyName: string;
  displayName?: string;
  accountNames: string[];
  platforms: string[];
  isAdmin: boolean;
  customerIds?: string[];
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('token')
  );

  // Attribute PostHog analytics to the signed-in user + company. Runs on fresh
  // login and on reload (when the user is restored from localStorage), so usage
  // is always tied to a tenant rather than an anonymous visitor.
  useEffect(() => {
    if (user) identifyTenant(user);
  }, [user]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    resetTracking();
    queryClient.clear();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}