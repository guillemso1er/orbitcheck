import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from '../AuthContext';

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Test component to use the auth context
const TestComponent: React.FC = () => {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div data-testid="user">{user ? user.email : 'No user'}</div>
      <div data-testid="is-authenticated">{isAuthenticated.toString()}</div>
      <button data-testid="login-btn" onClick={() => login({ id: '1', email: 'test@example.com' })}>
        Login
      </button>
      <button data-testid="logout-btn" onClick={logout}>
        Logout
      </button>
    </div>
  );
};

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
  });

  it('should initialize with no user', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByTestId('user')).toHaveTextContent('No user');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
  });

  it('should load user from localStorage on mount', async () => {
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'user') return JSON.stringify({ id: '1', email: 'stored@example.com' });
      return null;
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('stored@example.com');
      expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    });
  });

  it('should login user and store in localStorage', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    act(() => {
      screen.getByTestId('login-btn').click();
    });

    expect(screen.getByTestId('user')).toHaveTextContent('test@example.com');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('user', JSON.stringify({ id: '1', email: 'test@example.com' }));
  });

  it('should logout user and remove from localStorage', async () => {
    // First login
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'user') return JSON.stringify({ id: '1', email: 'stored@example.com' });
      return null;
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Wait for initial load to complete
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('stored@example.com'));

    act(() => {
      screen.getByTestId('logout-btn').click();
    });

    expect(screen.getByTestId('user')).toHaveTextContent('No user');
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');

    expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('user');
  });

  it('should transition to a loaded state upon initialization', async () => {
    const LoadingTestComponent: React.FC = () => {
      const { isLoading } = useAuth();
      return (
        <div>
          {isLoading ? (
            <div data-testid="loading">Loading</div>
          ) : (
            <div data-testid="loaded">Loaded</div>
          )}
        </div>
      );
    };

    render(
      <AuthProvider>
        <LoadingTestComponent />
      </AuthProvider>
    );

    // Because the useEffect runs quickly in a JSDOM environment,
    // we might miss the initial loading state. The important part is that
    // it transitions to the loaded state.
    expect(await screen.findByTestId('loaded')).toBeInTheDocument();
  });
});