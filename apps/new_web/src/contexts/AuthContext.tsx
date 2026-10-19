import React, { createContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import api, { authService } from '../services/api';
import { clearAgentToken } from '../services/agentClient';

export type User = {
  id: string;
  email: string;
  role: 'GESTOR' | 'CONSULTOR' | 'INVESTIDOR';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  stellar_public_key?: string;
}

export type AuthContextType = {
  isAuthenticated: boolean;
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('AuthProvider: Checking for token...');
    const token = localStorage.getItem('authToken');
    if (token) {
      console.log('AuthProvider: Token found, fetching profile...');
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      authService.getProfile()
        .then(profile => {
          console.log('AuthProvider: Profile fetched:', profile);
          setUser(profile.user);
        })
        .catch((error) => {
          console.error('AuthProvider: Failed to fetch profile:', error);
          localStorage.removeItem('authToken');
          setUser(null);
        })
        .finally(() => {
          console.log('AuthProvider: Loading complete');
          setLoading(false);
        });
    } else {
      console.log('AuthProvider: No token found');
      setLoading(false);
    }
  }, []);

  const login = async (token: string) => {
    clearAgentToken();
    localStorage.setItem('authToken', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    const profile = await authService.getProfile();
    setUser(profile.user); // The backend returns { user: ... }
  };

  const logout = () => {
    clearAgentToken();
    localStorage.removeItem('authToken');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const value = {
    isAuthenticated: !!user,
    user,
    loading,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

