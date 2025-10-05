import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../AuthContext';
import ApiKeys from '../components/ApiKeys';
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

// Mock the API client from @orbicheck/contracts
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
jest.mock('@orbicheck/contracts', () => ({
  createApiClient: jest.fn(() => mockApiClient)
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

const renderWithAuth = (component: React.ReactElement, token: string = 'test-token') => {
  const mockAuth = {
    user: { id: 'user1', email: 'test@example.com' },
    token,
    login: jest.fn(),
    logout: jest.fn(),
    isAuthenticated: true,
    isLoading: false,
  };
  
  jest.spyOn(require('../AuthContext'), 'useAuth').mockReturnValue(mockAuth);
  
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>{component}</AuthProvider>
    </BrowserRouter>
  );
};

describe('ApiKeys Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    mockApiClient.listApiKeys.mockResolvedValue({
      data: [{
        id: 'key1', prefix: 'test-prefix', name: 'Test Key',
        status: 'active', created_at: new Date().toISOString()
      }]
    });
  });

  it('should render API keys page header', () => {
    renderWithAuth(<ApiKeys token="test-token" />);
    
    expect(screen.getByRole('heading', { name: 'API Keys Management' })).toBeInTheDocument();
    expect(screen.getByText('Create New API Key')).toBeInTheDocument();
  });

  it('should display loading state initially', () => {
    mockApiClient.listApiKeys.mockImplementation(() => new Promise(() => {}));
    renderWithAuth(<ApiKeys token="test-token" />);
    
    expect(screen.getByText('Loading API keys...')).toBeInTheDocument();
  });

  it('should display API keys table when data is loaded', async () => {
    renderWithAuth(<ApiKeys token="test-token" />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
      expect(screen.getByText('test-prefix')).toBeInTheDocument();
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });

  it('should show empty state when no API keys exist', async () => {
    mockApiClient.listApiKeys.mockResolvedValue({ data: [] });
    renderWithAuth(<ApiKeys token="test-token" />);
    
    await waitFor(() => {
      expect(screen.getByText('No API keys found.')).toBeInTheDocument();
    });
  });

  it('should handle API key creation', async () => {
    renderWithAuth(<ApiKeys token="test-token" />);
    
    // Open create modal
    fireEvent.click(screen.getByText('Create New API Key'));
    
    // Fill form and submit
    fireEvent.change(screen.getByLabelText('Name (optional)'), {
      target: { value: 'Test API Key' }
    });
    fireEvent.click(screen.getByText('Create'));
    
    await waitFor(() => {
      expect(mockApiClient.createApiKey).toHaveBeenCalledWith('Test API Key');
    });
  });

  it('should handle API key revocation', async () => {
    window.confirm = jest.fn(() => true);
    renderWithAuth(<ApiKeys token="test-token" />);
    
    await waitFor(() => {
      expect(screen.getByText('REVOKE')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getAllByText('REVOKE')[0]);
    
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Are you sure you want to revoke this API key?')
    );
    expect(mockApiClient.revokeApiKey).toHaveBeenCalledWith('key1');
  });

  it('should handle API key rotation', async () => {
    window.confirm = jest.fn(() => true);
    renderWithAuth(<ApiKeys token="test-token" />);
    
    await waitFor(() => {
      expect(screen.getByText('ROTATE')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getAllByText('ROTATE')[0]);
    
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Rotate this key?')
    );
    expect(mockApiClient.createApiKey).toHaveBeenCalledWith('Test Key');
    expect(mockApiClient.revokeApiKey).toHaveBeenCalledWith('key1');
  });

  it('should show new key alert after creation', async () => {
    renderWithAuth(<ApiKeys token="test-token" />);
    
    // Open create modal
    fireEvent.click(screen.getByText('Create New API Key'));
    
    // Fill form and submit
    fireEvent.change(screen.getByLabelText('Name (optional)'), {
      target: { value: 'Test API Key' }
    });
    fireEvent.click(screen.getByText('Create'));
    
    await waitFor(() => {
      expect(screen.getByText('New API Key Created')).toBeInTheDocument();
      expect(screen.getByText('new-prefix')).toBeInTheDocument();
      expect(screen.getByText('new-full-key-1234567890')).toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    mockApiClient.listApiKeys.mockRejectedValue(new Error('API Error'));
    renderWithAuth(<ApiKeys token="test-token" />);
    
    await waitFor(() => {
      expect(screen.getByText('Error: API Error')).toBeInTheDocument();
    });
  });

  it('should disable actions when creating/rotating keys', async () => {
    mockApiClient.createApiKey.mockImplementation(() => new Promise(() => {}));
    renderWithAuth(<ApiKeys token="test-token" />);
    
    // Open create modal
    fireEvent.click(screen.getByText('Create New API Key'));
    
    // Fill form and submit
    fireEvent.change(screen.getByLabelText('Name (optional)'), {
      target: { value: 'Test API Key' }
    });
    fireEvent.click(screen.getByText('Create'));
    
    await waitFor(() => {
      expect(screen.getByText('Creating...')).toBeInTheDocument();
    });
    
    // Check that rotate button is disabled
    expect(screen.getAllByText('ROTATE')[0]).toBeDisabled();
  });
});