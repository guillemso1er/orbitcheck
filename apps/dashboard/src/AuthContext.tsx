import { getUserPlan, loginUser, logoutUser } from '@orbitcheck/contracts';
import React, { createContext, ReactNode, useContext, useEffect } from 'react';
import { LOCAL_STORAGE_KEYS } from './constants';
import { useCsrfCookie } from './hooks/useCsrfCookie';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useApiClient } from './utils/api.ts';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  csrfToken: string | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: unknown }>;
  logout: () => Promise<void>;
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
  const [isLoading, setIsLoading] = React.useState(true);
  const apiClient = useApiClient();

  const user = localUser || sessionUser;

  // Initialize auth state on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Validate session with server - cookies are HttpOnly
        const response = await getUserPlan({ client: apiClient });
        const data = response.data;

        if (data?.id && data?.email) {
          const serverUser = {
            id: data.id,
            email: data.email,
          };
          setLocalUser(serverUser);
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  // Periodic session validation to keep auth state in sync
  useEffect(() => {
    if (!user) return; // Only run if user is logged in

    const validateSession = async () => {
      try {
        await getUserPlan({ client: apiClient });
      } catch (error) {
        console.error('Session validation failed:', error);
        setLocalUser(null);
        setSessionUser(null);
      }
    };

    // Validate session every 5 minutes
    const interval = setInterval(validateSession, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user, setLocalUser, setSessionUser, apiClient]);

  const login = async (email: string, password: string, rememberMe: boolean = true) => {
    try {
      const response = await loginUser({
        client: apiClient,
        body: {
          email,
          password,
          rememberMe,
        },
      });

      const userData = response.data?.user;

      // Only proceed if we have valid user data
      if (userData?.id && userData?.email) {
        const serverUser = {
          id: userData.id,
          email: userData.email,
        };

        // Store user in appropriate storage
        if (rememberMe) {
          setLocalUser(serverUser);
        } else {
          setSessionUser(serverUser);
        }
      } else {
        throw new Error('Invalid user data received from login');
      }

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error };
    }
  };

  const logout = async () => {
    try {
      await logoutUser({ client: apiClient });
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setLocalUser(null);
      setSessionUser(null);
      // Server clears HttpOnly cookies via Set-Cookie headers
    }
  };

  const value: AuthContextType = {
    user,
    csrfToken,
    login,
    logout,
    isAuthenticated: !!user && !!csrfToken,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};