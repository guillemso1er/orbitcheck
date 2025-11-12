import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { LOCAL_STORAGE_KEYS } from './constants';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  csrfToken: string | null;
  login: (user: User, csrfToken: string, rememberMe?: boolean) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem(LOCAL_STORAGE_KEYS.USER) || sessionStorage.getItem(LOCAL_STORAGE_KEYS.USER);
    const storedCsrfToken = localStorage.getItem(LOCAL_STORAGE_KEYS.CSRF_TOKEN) || sessionStorage.getItem(LOCAL_STORAGE_KEYS.CSRF_TOKEN);
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    if (storedCsrfToken) {
      setCsrfToken(storedCsrfToken);
    }
    setIsLoading(false);
  }, []);

  const login = (newUser: User, newCsrfToken: string, rememberMe: boolean = true) => {
    setUser(newUser);
    setCsrfToken(newCsrfToken);
    const storage = rememberMe ? localStorage : sessionStorage;
    storage.setItem(LOCAL_STORAGE_KEYS.USER, JSON.stringify(newUser));
    storage.setItem(LOCAL_STORAGE_KEYS.CSRF_TOKEN, newCsrfToken);
  };

  const logout = () => {
    setUser(null);
    setCsrfToken(null);
    localStorage.removeItem(LOCAL_STORAGE_KEYS.USER);
    localStorage.removeItem(LOCAL_STORAGE_KEYS.CSRF_TOKEN);
    sessionStorage.removeItem(LOCAL_STORAGE_KEYS.USER);
    sessionStorage.removeItem(LOCAL_STORAGE_KEYS.CSRF_TOKEN);
  };

  const value: AuthContextType = {
    user,
    csrfToken,
    login,
    logout,
    isAuthenticated: !!user,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};