
jest.mock('@orbitcheck/contracts');

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from '../App';
import { UI_STRINGS } from '../constants';

// Mock Chart.js and its components
jest.mock('chart.js', () => ({
  Chart: {
    register: jest.fn(),
    defaults: {
      global: {},
    },
  },
  CategoryScale: jest.fn(),
  LinearScale: jest.fn(),
  PointElement: jest.fn(),
  LineElement: jest.fn(),
  BarElement: jest.fn(),
  ArcElement: jest.fn(),
  Title: jest.fn(),
  Tooltip: jest.fn(),
  Legend: jest.fn(),
}));

// Mock react-chartjs-2 components to render simple placeholders
jest.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="line-chart">Mock Line Chart</div>,
  Bar: () => <div data-testid="bar-chart">Mock Bar Chart</div>,
  Pie: () => <div data-testid="pie-chart">Mock Pie Chart</div>,
}));

// Mock the API client from @orbitcheck/contracts
const mockApiClient = {
  getUsage: jest.fn().mockResolvedValue({
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
  }),
  getLogs: jest.fn().mockResolvedValue({
    data: [{
      id: 'log1', type: 'validation', endpoint: '/validate/email',
      reason_codes: [], status: 200, created_at: new Date().toISOString(), meta: {}
    }],
    next_cursor: null, total_count: 1
  }),
  getApiKeys: jest.fn().mockResolvedValue({
    data: [{
      id: 'key1', prefix: 'test-prefix', name: 'Test Key',
      status: 'active', created_at: new Date().toISOString()
    }]
  }),
  listApiKeys: jest.fn().mockResolvedValue({
    data: [{
      id: 'key1', prefix: 'test-prefix', name: 'Test Key',
      status: 'active', created_at: new Date().toISOString()
    }]
  }),
  createApiKey: jest.fn().mockResolvedValue({
    prefix: 'new-prefix',
    full_key: 'new-full-key-1234567890'
  }),
  revokeApiKey: jest.fn().mockResolvedValue({}),
  rotateApiKey: jest.fn().mockResolvedValue({
    prefix: 'rotated-prefix',
    full_key: 'rotated-full-key-1234567890'
  }),
  loginUser: jest.fn().mockResolvedValue({
    token: 'test-token',
    user: { id: 'user-id', email: 'test@example.com' }
  })
};

jest.mock('@orbitcheck/contracts', () => ({
  createApiClient: jest.fn(() => mockApiClient)
}));

// Mock the components
jest.mock('../components/ApiKeys', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="api-keys-component">
      <h2>{UI_STRINGS.API_KEYS_MANAGEMENT}</h2>
    </div>
  ),
}));

jest.mock('../components/UsageDashboard', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="usage-dashboard-component">
      <h2>{UI_STRINGS.USAGE_DASHBOARD}</h2>
    </div>
  ),
}));

jest.mock('../components/LogExplorer', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="log-explorer-component">
      <h2>{UI_STRINGS.LOG_EXPLORER}</h2>
    </div>
  ),
}));

jest.mock('../components/WebhookTester', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="webhook-tester-component">
      <h2>{UI_STRINGS.WEBHOOK_TESTER}</h2>
    </div>
  ),
}));

jest.mock('../components/Login', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="login-component">
      <h2>Welcome Back</h2>
      <button>Sign In</button>
    </div>
  ),
}));

// Mock react-router-dom's useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

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

// Mock ResizeObserver for chart responsiveness
const mockResizeObserver = {
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
};
Object.defineProperty(window, 'ResizeObserver', {
  value: jest.fn(() => mockResizeObserver),
});

// Store the current auth state for dynamic updates
let currentAuthState = {
  user: null as any,
  token: null as string | null,
  login: jest.fn(),
  logout: jest.fn(),
  isAuthenticated: false,
  isLoading: false,
};

// Mock the AuthContext
jest.mock('../AuthContext', () => {
  return {
    useAuth: jest.fn(() => currentAuthState),
    AuthProvider: ({ children }: { children: React.ReactNode }) => {
      return <>{children}</>;
    },
  };
});

import { useAuth } from '../AuthContext';
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

// Create mock auth context with proper implementation
const createMockAuthContext = (isAuthenticated: boolean, isLoading = false) => {
  const mockAuth = {
    user: isAuthenticated ? { id: 'user1', email: 'test@example.com' } : null,
    token: isAuthenticated ? 'test-token' : null,
    login: jest.fn(),
    logout: jest.fn((callback?: () => void) => {
      // When logout is called, update the current auth state
      currentAuthState = {
        ...currentAuthState,
        user: null,
        token: null,
        isAuthenticated: false,
      };
      if (callback) callback();
    }),
    isAuthenticated,
    isLoading,
  };

  currentAuthState = mockAuth;
  mockUseAuth.mockReturnValue(mockAuth);
  return mockAuth;
};

// Render with router wrapper - always wrap with BrowserRouter
const renderWithRouter = (component: React.ReactElement, initialRoute = '/') => {
  window.history.pushState({}, 'Test page', initialRoute);

  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {component}
    </BrowserRouter>
  );
};

// Helper function to set up localStorage for authenticated state
const setupAuthenticatedState = () => {
  mockLocalStorage.getItem.mockImplementation((key: string) => {
    if (key === 'token') return 'test-token';
    if (key === 'user') return JSON.stringify({ id: 'user1', email: 'test@example.com' });
    return null;
  });
  return createMockAuthContext(true);
};

// Helper function to set up localStorage for unauthenticated state
const setupUnauthenticatedState = () => {
  mockLocalStorage.getItem.mockImplementation(() => null);
  return createMockAuthContext(false);
};

describe('Authentication and Page Refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
  });

  it('should maintain authentication state after a page refresh', async () => {
    setupAuthenticatedState();

    const { rerender } = renderWithRouter(<App />);

    // Wait for initial loading to complete and show authenticated content
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
    });

    // Simulate a page refresh by re-rendering the component WITH the router wrapper
    rerender(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    );

    // Should still be authenticated and show the content
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
    });
  });

  it('should redirect to login page when not authenticated', async () => {
    setupUnauthenticatedState();

    renderWithRouter(<App />, '/api-keys');

    // Should show the login form
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    });
  });
});

describe('Navigation and Routing', () => {
  beforeEach(() => {
    setupAuthenticatedState();
    jest.clearAllMocks();
  });

  it('should navigate to the Usage Dashboard', async () => {
    renderWithRouter(<App />);

    // Wait for the default page to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
    });

    // Click on the "Usage Dashboard" navigation link
    fireEvent.click(screen.getByText(UI_STRINGS.USAGE_DASHBOARD));

    // Should navigate and display the usage dashboard content
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.USAGE_DASHBOARD })).toBeInTheDocument();
    });
  });

  it('should navigate to the Log Explorer', async () => {
    renderWithRouter(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(UI_STRINGS.LOG_EXPLORER));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.LOG_EXPLORER })).toBeInTheDocument();
    });
  });

  it('should navigate to the Webhook Tester', async () => {
    renderWithRouter(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(UI_STRINGS.WEBHOOK_TESTER));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.WEBHOOK_TESTER })).toBeInTheDocument();
    });
  });

  it('should handle logout and redirect to the login page', async () => {
    // Setup initial authenticated state
    setupAuthenticatedState();

    // Override the logout mock to actually change the auth state
    currentAuthState.logout = jest.fn(() => {
      // Update the current auth state to unauthenticated
      currentAuthState = {
        ...currentAuthState,
        user: null,
        token: null,
        isAuthenticated: false,
      };
      // Update the mock to return the new state
      mockUseAuth.mockReturnValue(currentAuthState);
    });

    const { rerender } = renderWithRouter(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
    });

    // Click the logout button
    fireEvent.click(screen.getByText(UI_STRINGS.LOGOUT));

    // Force a re-render to pick up the new auth state
    rerender(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    );

    // Should redirect to the login page
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    });
  });
});

describe('App Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    mockNavigate.mockClear();
  });

  describe('Navigation and Routing', () => {
    beforeEach(() => {
      setupAuthenticatedState();
      jest.clearAllMocks();
    });

    it('should default to the API Keys route and allow navigation', async () => {
      renderWithRouter(<App />);

      // Wait for the default authenticated page to load
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
      });

      // Find the nav link by looking for the nav element with the correct class
      const navLinks = screen.getAllByText(UI_STRINGS.API_KEYS_MANAGEMENT);
      // The first one is likely the nav link, second might be the heading
      const apiKeysLink = navLinks.find(el => el.closest('.nav-link')) || navLinks[0];

      fireEvent.click(apiKeysLink);

      // Should still show the same page
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
      });
    });

    it('should handle mobile navigation', async () => {
      // Mock window.innerWidth to simulate a mobile device
      Object.defineProperty(window, 'innerWidth', {
        value: 480,
        writable: true,
        configurable: true
      });

      // Set authenticated state for mobile navigation test
      setupAuthenticatedState();

      renderWithRouter(<App />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
      });

      // Open the mobile sidebar menu
      const mobileMenuButton = screen.getByRole('button', { name: /toggle navigation menu/i });
      fireEvent.click(mobileMenuButton);

      // Navigate to a different page
      const usageLink = screen.getByText(UI_STRINGS.USAGE_DASHBOARD);
      fireEvent.click(usageLink);

      // The new page should be displayed
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: UI_STRINGS.USAGE_DASHBOARD })).toBeInTheDocument();
      });
    });
  });

  describe('ProtectedRoute Behavior', () => {
    it('should redirect an unauthenticated user to the login page', async () => {
      setupUnauthenticatedState();
      renderWithRouter(<App />);

      // Assert that the login page is shown
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
        expect(screen.getByText('Sign In')).toBeInTheDocument();
      });
    });

    it('should render the authenticated content when the user is logged in', async () => {
      setupAuthenticatedState();

      renderWithRouter(<App />);

      // Assert that the main application content is visible
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: UI_STRINGS.API_KEYS_MANAGEMENT })).toBeInTheDocument();
      });
    });
  });
});