import React, { createContext, ReactNode, useContext } from 'react';
import { LOCAL_STORAGE_KEYS } from './constants';
import { useCsrfCookie } from './hooks/useCsrfCookie';
import { useLocalStorage } from './hooks/useLocalStorage';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  csrfToken: string | null;
  login: (user: User, rememberMe?: boolean) => void;
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
  const [localUser, setLocalUser] = useLocalStorage<User | null>(LOCAL_STORAGE_KEYS.USER, null);
  const [sessionUser, setSessionUser] = useLocalStorage<User | null>(LOCAL_STORAGE_KEYS.USER, null, sessionStorage);
  const csrfToken = useCsrfCookie();

  const user = localUser || sessionUser;

  const login = (newUser: User, rememberMe: boolean = true) => {
    if (rememberMe) {
      setLocalUser(newUser);
    } else {
      setSessionUser(newUser);
    }
  };

  const logout = () => {
    setLocalUser(null);
    setSessionUser(null);
  };

  const value: AuthContextType = {
    user,
    csrfToken,
    login,
    logout,
    isAuthenticated: !!user,
    isLoading: false,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};