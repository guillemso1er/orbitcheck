
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import UsageDashboard from '../components/UsageDashboard';
import { UI_STRINGS } from '../constants';

// Import these after the module resolution is set up
import '../constants';

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
  getUsage: jest.fn(),
  getLogs: jest.fn(),
  getApiKeys: jest.fn(),
  listApiKeys: jest.fn(),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  rotateApiKey: jest.fn(),
  loginUser: jest.fn(),
  testWebhook: jest.fn(),
  batchValidateData: jest.fn(),
  batchDedupeData: jest.fn(),
  getJobStatus: jest.fn(),
  evaluateOrder: jest.fn(),
};

// Mock the createApiClient to return our mock client
jest.mock('@orbitcheck/contracts', () => ({
  ...jest.requireActual('@orbitcheck/contracts'),
  createApiClient: jest.fn(() => mockApiClient)
}));

// Mock AuthContext
jest.mock('../AuthContext', () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useAuth } from '../AuthContext';
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

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

const renderWithAuth = (component: React.ReactElement) => {
  mockUseAuth.mockReturnValue({
    user: { id: 'user1', email: 'test@example.com' },
    login: jest.fn(),
    logout: jest.fn(),
    isAuthenticated: true,
    isLoading: false,
  });

  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {component}
    </BrowserRouter>
  );
};

describe('UsageDashboard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();

    // Set default successful response
    mockApiClient.getUsage.mockResolvedValue({
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
    });
  });

  it('should render Usage Dashboard page header', async () => {
    renderWithAuth(<UsageDashboard />);

    // Wait for the component to load
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.USAGE_DASHBOARD })).toBeInTheDocument();
    });
  });

  it('should display loading state initially', () => {
    mockApiClient.getUsage.mockImplementation(() => new Promise(() => { }));
    renderWithAuth(<UsageDashboard />);

    expect(screen.getByText(`${UI_STRINGS.LOADING} usage dashboard...`)).toBeInTheDocument();
  });

  it('should display stats cards when data is loaded', async () => {
    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.TOTAL_VALIDATIONS)).toBeInTheDocument();
      expect(screen.getByText(UI_STRINGS.TOTAL_ORDERS)).toBeInTheDocument();
      // Use getAllByText since "Cache Hit Ratio" appears multiple times
      const cacheHitElements = screen.getAllByText(UI_STRINGS.CACHE_HIT_RATIO);
      expect(cacheHitElements.length).toBeGreaterThan(0);
      expect(screen.getByText('1,000')).toBeInTheDocument();
      expect(screen.getByText('500')).toBeInTheDocument();
      expect(screen.getByText('85.5%')).toBeInTheDocument();
    });
  });

  it('should display daily usage chart', async () => {
    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.DAILY_USAGE)).toBeInTheDocument();
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    });
  });

  it('should display top reason codes chart', async () => {
    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.TOP_REASON_CODES)).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  it('should display cache hit ratio chart', async () => {
    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      // Use getAllByText since "Cache Hit Ratio" appears in both stats and chart
      const cacheHitElements = screen.getAllByText(UI_STRINGS.CACHE_HIT_RATIO);
      expect(cacheHitElements.length).toBe(2); // One in stats, one in chart
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    mockApiClient.getUsage.mockRejectedValue(new Error('API Error'));
    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Error: API Error')).toBeInTheDocument();
    });
  });

  it('should display empty state when no data is available', async () => {
    // Mock getUsage to return null/undefined to trigger the empty state
    mockApiClient.getUsage.mockResolvedValue(null);

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.NO_DATA)).toBeInTheDocument();
    });
  });

  it('should handle zero values correctly', async () => {
    mockApiClient.getUsage.mockResolvedValue({
      period: '7d',
      totals: { validations: 0, orders: 0 },
      by_day: [
        { date: '2023-01-01', validations: 0, orders: 0 },
        { date: '2023-01-02', validations: 0, orders: 0 }
      ],
      top_reason_codes: [],
      cache_hit_ratio: 0,
      request_id: 'test-request-id'
    });

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      // Use getAllByText since there might be multiple "0" values
      const zeroElements = screen.getAllByText('0');
      expect(zeroElements.length).toBeGreaterThan(0);
      expect(screen.getByText('0.0%')).toBeInTheDocument();
    });
  });

  it('should handle 100% cache hit ratio', async () => {
    mockApiClient.getUsage.mockResolvedValue({
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
      cache_hit_ratio: 100,
      request_id: 'test-request-id'
    });

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText('100.0%')).toBeInTheDocument();
    });
  });

  it('should handle large numbers with proper formatting', async () => {
    mockApiClient.getUsage.mockResolvedValue({
      period: '7d',
      totals: { validations: 1000000, orders: 500000 },
      by_day: [
        { date: '2023-01-01', validations: 100000, orders: 50000 },
        { date: '2023-01-02', validations: 150000, orders: 75000 }
      ],
      top_reason_codes: [
        { code: 'TEST1', count: 100000 },
        { code: 'TEST2', count: 50000 }
      ],
      cache_hit_ratio: 85.5,
      request_id: 'test-request-id'
    });

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText('1,000,000')).toBeInTheDocument();
      expect(screen.getByText('500,000')).toBeInTheDocument();
    });
  });

  it('should handle single day data', async () => {
    mockApiClient.getUsage.mockResolvedValue({
      period: '1d',
      totals: { validations: 100, orders: 50 },
      by_day: [
        { date: '2023-01-01', validations: 100, orders: 50 }
      ],
      top_reason_codes: [
        { code: 'TEST1', count: 100 }
      ],
      cache_hit_ratio: 85.5,
      request_id: 'test-request-id'
    });

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      // The date will be used in the chart data, but not directly displayed as text
      // Instead, verify the dashboard loaded successfully
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
    });
  });

  it('should handle empty top reason codes', async () => {
    mockApiClient.getUsage.mockResolvedValue({
      period: '7d',
      totals: { validations: 1000, orders: 500 },
      by_day: [
        { date: '2023-01-01', validations: 100, orders: 50 },
        { date: '2023-01-02', validations: 150, orders: 75 }
      ],
      top_reason_codes: [],
      cache_hit_ratio: 85.5,
      request_id: 'test-request-id'
    });

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText(UI_STRINGS.TOP_REASON_CODES)).toBeInTheDocument();
    });
  });

  it('should handle chart data preparation correctly', async () => {
    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      // Check that charts are rendered with correct test IDs
      expect(screen.getByTestId('line-chart')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });
  });

  it('should display responsive layout for mobile', async () => {
    // Mock window.innerWidth to simulate mobile
    Object.defineProperty(window, 'innerWidth', {
      value: 480,
      writable: true,
      configurable: true
    });

    renderWithAuth(<UsageDashboard />);

    // The component should still render correctly on mobile
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_STRINGS.USAGE_DASHBOARD })).toBeInTheDocument();
    });
  });

  it('should handle different time periods', async () => {
    mockApiClient.getUsage.mockResolvedValue({
      period: '30d',
      totals: { validations: 10000, orders: 5000 },
      by_day: [
        { date: '2023-01-01', validations: 1000, orders: 500 },
        { date: '2023-01-02', validations: 1500, orders: 750 }
      ],
      top_reason_codes: [
        { code: 'TEST1', count: 1000 },
        { code: 'TEST2', count: 500 }
      ],
      cache_hit_ratio: 85.5,
      request_id: 'test-request-id'
    });

    renderWithAuth(<UsageDashboard />);

    await waitFor(() => {
      expect(screen.getByText('10,000')).toBeInTheDocument();
      expect(screen.getByText('5,000')).toBeInTheDocument();
    });
  });
});