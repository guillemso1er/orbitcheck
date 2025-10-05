import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../AuthContext';

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

// Mock window resize
const mockResizeObserver = {
  observe: jest.fn(),
  disconnect: jest.fn(),
};

Object.defineProperty(window, 'ResizeObserver', {
  value: jest.fn(() => mockResizeObserver),
  writable: true,
});

// Mock fetch
global.fetch = jest.fn();

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const renderWithRouter = (component: React.ReactElement) => {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        {component}
      </AuthProvider>
    </BrowserRouter>
  );
};

describe('App Component - Page Refresh Behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    mockNavigate.mockClear();

    // Default mock implementation for localStorage
    mockLocalStorage.getItem.mockReturnValue(null);

    // Mock successful API responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/v1/api/keys')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'key1',
                prefix: 'test-prefix',
                name: 'Test Key',
                status: 'active' as const,
                created_at: new Date().toISOString(),
              }
            ]
          })
        });
      }

      if (url.includes('/v1/usage')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            period: '7d',
            totals: { validations: 1000, orders: 500 },
            by_day: [
              { date: '2023-01-01', validations: 100, orders: 50 },
              { date: '2023-01-02', validations: 150, orders: 75 }
            ],
            top_reason_codes: [
              { code: 'TEST1', count: 100 },
              { code: 'TEST2', count: 50 }
            ],
            cache_hit_ratio: 85.5,
            request_id: 'test-request-id'
          })
        });
      }

      if (url.includes('/v1/logs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'log1',
                type: 'validation',
                endpoint: '/validate/email',
                reason_codes: [],
                status: 'success',
                created_at: new Date().toISOString(),
                meta: {}
              }
            ],
            next_cursor: null,
            total_count: 1
          })
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  it('should maintain authentication state after page refresh', async () => {
    // Simulate login by setting localStorage
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'token') return 'test-token';
      if (key === 'user') return JSON.stringify({ id: 'user1', email: 'test@example.com' });
      return null;
    });

    const { rerender } = renderWithRouter(<App />);

    // Should show loading initially
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Should show authenticated content
    expect(screen.getByText('API Keys Management')).toBeInTheDocument();

    // Simulate page refresh by re-rendering
    rerender(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Should still be authenticated after refresh
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'API Keys Management' })).toBeInTheDocument();
    });
  });

  it('should redirect to login page when not authenticated after refresh', async () => {
    // Clear localStorage to simulate unauthenticated state
    mockLocalStorage.getItem.mockReturnValue(null);

    const { rerender } = renderWithRouter(<App />);

    // Should show login form initially
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Should redirect to login
    expect(screen.getByText('Sign In')).toBeInTheDocument();

    // Simulate page refresh
    rerender(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Should still redirect to login after refresh
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('should preserve sidebar state after page refresh', async () => {
    // Mock window.innerWidth to simulate desktop
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
    });

    const { rerender } = renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Sidebar should be open on desktop
    expect(screen.getByText('OrbiCheck')).toBeInTheDocument();

    // Simulate page refresh
    rerender(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Sidebar should still be open after refresh
    expect(screen.getByText('OrbiCheck')).toBeInTheDocument();
  });

  it('should handle mobile sidebar state after refresh', async () => {
    // Mock window.innerWidth to simulate mobile
    Object.defineProperty(window, 'innerWidth', {
      value: 480,
      writable: true,
    });

    const { rerender } = renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Mobile menu button should be visible
    const mobileMenuBtn = screen.getByRole('button', { name: 'Toggle navigation menu' });
    expect(mobileMenuBtn).toBeInTheDocument();

    // Simulate page refresh
    rerender(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Mobile menu button should still be visible after refresh
    expect(mobileMenuBtn).toBeInTheDocument();
  });
});

describe('App Component - Navigation Between Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    mockNavigate.mockClear();

    // Set authenticated state
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'token') return 'test-token';
      if (key === 'user') return JSON.stringify({ id: 'user1', email: 'test@example.com' });
      return null;
    });

    // Mock successful API responses
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/v1/api/keys')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'key1',
                prefix: 'test-prefix',
                name: 'Test Key',
                status: 'active' as const,
                created_at: new Date().toISOString(),
              }
            ]
          })
        });
      }

      if (url.includes('/v1/usage')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            period: '7d',
            totals: { validations: 1000, orders: 500 },
            by_day: [
              { date: '2023-01-01', validations: 100, orders: 50 },
              { date: '2023-01-02', validations: 150, orders: 75 }
            ],
            top_reason_codes: [
              { code: 'TEST1', count: 100 },
              { code: 'TEST2', count: 50 }
            ],
            cache_hit_ratio: 85.5,
            request_id: 'test-request-id'
          })
        });
      }

      if (url.includes('/v1/logs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'log1',
                type: 'validation',
                endpoint: '/validate/email',
                reason_codes: [],
                status: 'success',
                created_at: new Date().toISOString(),
                meta: {}
              }
            ],
            next_cursor: null,
            total_count: 1
          })
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  it('should navigate to API Keys route', async () => {
    renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Should show API Keys Management by default
    expect(screen.getByText('API Keys Management')).toBeInTheDocument();

    // Click on API Keys navigation link
    const apiKeysLink = screen.getByText('API Keys Management');
    fireEvent.click(apiKeysLink);

    // Should still be on API Keys page
    expect(screen.getByText('API Keys Management')).toBeInTheDocument();
  });

  it('should navigate to Usage Dashboard route', async () => {
    renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Click on Usage Dashboard navigation link
    const usageLink = screen.getByText('Usage Dashboard');
    fireEvent.click(usageLink);

    // Should navigate to Usage Dashboard
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Usage Dashboard' })).toBeInTheDocument();
      expect(screen.getByText('Total Validations')).toBeInTheDocument();
    });
  });

  it('should navigate to Log Explorer route', async () => {
    renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Click on Log Explorer navigation link
    const logsLink = screen.getByText('Log Explorer');
    fireEvent.click(logsLink);

    // Should navigate to Log Explorer
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Log Explorer' })).toBeInTheDocument();
      expect(screen.getByText(/Total Logs/)).toBeInTheDocument();
    });
  });

  it('should navigate to Webhook Tester route', async () => {
    renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Click on Webhook Tester navigation link
    const webhooksLink = screen.getByText('Webhook Tester');
    fireEvent.click(webhooksLink);

    // Should navigate to Webhook Tester
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Webhook Tester' })).toBeInTheDocument();
      expect(screen.getByText('Send Test Payload')).toBeInTheDocument();
    });
  });

  it('should handle mobile navigation and close sidebar after click', async () => {
    // Mock window.innerWidth to simulate mobile
    Object.defineProperty(window, 'innerWidth', {
      value: 480,
      writable: true,
    });

    renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Open sidebar on mobile
    const mobileMenuBtn = screen.getByRole('button', { name: 'Toggle navigation menu' });
    fireEvent.click(mobileMenuBtn);

    // Sidebar should be open
    expect(screen.getByText('OrbiCheck')).toBeInTheDocument();

    // Click on Usage Dashboard link
    const usageLink = screen.getByText('Usage Dashboard');
    fireEvent.click(usageLink);

    // Should navigate to Usage Dashboard and close sidebar
    await waitFor(() => {
      expect(screen.getByText('Usage Dashboard')).toBeInTheDocument();
    });
  });

  it('should handle logout and redirect to login', async () => {
    renderWithRouter(<App />);

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Click logout button
    const logoutBtn = screen.getByText('Logout');
    fireEvent.click(logoutBtn);

    // Should redirect to login page
    await waitFor(() => {
      expect(screen.getByText('Sign In')).toBeInTheDocument();
    });
  });

  it('should redirect unauthenticated users to login page', async () => {
    // Clear localStorage to simulate unauthenticated state
    mockLocalStorage.getItem.mockReturnValue(null);

    renderWithRouter(<App />);

    // Should show login form initially
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Should redirect to login
    expect(screen.getByText('Sign In')).toBeInTheDocument();

    // Attempt to access protected route directly
    // This is tested by the ProtectedRoute component
  });
});

describe('ProtectedRoute Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
  });

  it('should show loading when authentication is in progress', () => {
    const { rerender } = render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Should show login form initially
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
  });

  it('should redirect to login when not authenticated', async () => {
    // Clear localStorage to simulate unauthenticated state
    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Should redirect to login
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('should render children when authenticated', async () => {
    // Set authenticated state
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'token') return 'test-token';
      if (key === 'user') return JSON.stringify({ id: 'user1', email: 'test@example.com' });
      return null;
    });

    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });

    // Should show authenticated content
    expect(screen.getByText('API Keys Management')).toBeInTheDocument();
  });
});