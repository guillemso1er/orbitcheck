import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../AuthContext';
import ApiKeys from '../components/ApiKeys';

// Import these after the module resolution is set up
import '../constants';

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

// Create mock API client methods
const mockApiClient = {
  registerUser: jest.fn(),
  loginUser: jest.fn(),
  getUsage: jest.fn(),
  getLogs: jest.fn(),
  listApiKeys: jest.fn(),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  testWebhook: jest.fn(),
  batchValidateData: jest.fn(),
  batchDedupeData: jest.fn(),
  getJobStatus: jest.fn(),
  evaluateOrder: jest.fn(),
};

// Mock the createApiClient to return our mock client
jest.mock('@orbitcheck/contracts', () => ({
  ...jest.requireActual('@orbitcheck/contracts'),
  createApiClient: jest.fn(() => mockApiClient),
}));

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

    // Set up default mock responses
    mockApiClient.listApiKeys.mockResolvedValue({
      data: [{
        id: 'key1',
        name: 'Test Key',
        prefix: 'test-prefix',
        status: 'active',
        created_at: new Date().toISOString(),
        last_used_at: null
      }]
    });

    mockApiClient.createApiKey.mockResolvedValue({
      prefix: 'new-prefix',
      full_key: 'new-full-key-1234567890'
    });

    mockApiClient.revokeApiKey.mockResolvedValue({});
  });

  afterEach(async () => {
    // Wait for any pending async operations to complete
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('should render API keys page header', async () => {
    renderWithAuth(<ApiKeys token="test-token" />);

    expect(screen.getByRole('heading', { name: 'API Keys Management' })).toBeInTheDocument();
    expect(screen.getByText('Create New API Key')).toBeInTheDocument();

    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.queryByText('Loading API keys...')).not.toBeInTheDocument();
    });
  });

  it('should display loading state initially', () => {
    mockApiClient.listApiKeys.mockImplementation(() => new Promise(() => { }));
    renderWithAuth(<ApiKeys token="test-token" />);

    expect(screen.getByText('Loading API keys...')).toBeInTheDocument();
  });

  it('should display API keys table when data is loaded', async () => {
    renderWithAuth(<ApiKeys token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
    });

    expect(screen.getByText('test-prefix')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
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

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
    });

    // Open create modal
    await act(async () => {
      fireEvent.click(screen.getByText('Create New API Key'));
    });

    // Fill form and submit
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Name (optional)'), {
        target: { value: 'Test API Key' }
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Create'));
    });

    await waitFor(() => {
      expect(mockApiClient.createApiKey).toHaveBeenCalledWith('Test API Key');
    });

    // Wait for the new key alert to appear
    await waitFor(() => {
      expect(screen.getByText('New API Key Created')).toBeInTheDocument();
    });
  });

  it('should handle API key revocation', async () => {
    window.confirm = jest.fn(() => true);
    renderWithAuth(<ApiKeys token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
    });

    // Find and click the REVOKE button
    const revokeButtons = screen.getAllByText('REVOKE');

    await act(async () => {
      fireEvent.click(revokeButtons[0]);
    });

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Are you sure you want to revoke this API key?')
    );

    await waitFor(() => {
      expect(mockApiClient.revokeApiKey).toHaveBeenCalledWith('key1');
    });
  });

  it('should handle API key rotation', async () => {
    window.confirm = jest.fn(() => true);
    renderWithAuth(<ApiKeys token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
    });

    // Find and click the ROTATE button
    const rotateButtons = screen.getAllByText('ROTATE');

    await act(async () => {
      fireEvent.click(rotateButtons[0]);
    });

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Rotate this key?')
    );

    await waitFor(() => {
      expect(mockApiClient.createApiKey).toHaveBeenCalledWith('Test Key');
    });

    await waitFor(() => {
      expect(mockApiClient.revokeApiKey).toHaveBeenCalledWith('key1');
    });
  });

  it('should show new key alert after creation', async () => {
    renderWithAuth(<ApiKeys token="test-token" />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
    });

    // Open create modal
    await act(async () => {
      fireEvent.click(screen.getByText('Create New API Key'));
    });

    // Fill form and submit
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Name (optional)'), {
        target: { value: 'Test API Key' }
      });
      fireEvent.click(screen.getByText('Create'));
    });

    await waitFor(() => {
      expect(screen.getByText('New API Key Created')).toBeInTheDocument();
    });

    expect(screen.getByText('new-prefix')).toBeInTheDocument();
    expect(screen.getByText('new-full-key-1234567890')).toBeInTheDocument();
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mockApiClient.listApiKeys.mockRejectedValue(new Error(errorMessage));
    renderWithAuth(<ApiKeys token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText(`Error: ${errorMessage}`)).toBeInTheDocument();
    });
  });

  it('should disable actions when creating/rotating keys', async () => {
    // Set up a delayed promise for createApiKey
    let resolveCreate: any;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    mockApiClient.createApiKey.mockImplementation(() => createPromise);

    renderWithAuth(<ApiKeys token="test-token" />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Test Key')).toBeInTheDocument();
    });

    // Open create modal
    await act(async () => {
      fireEvent.click(screen.getByText('Create New API Key'));
    });

    // Fill form and submit
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Name (optional)'), {
        target: { value: 'Test API Key' }
      });
      fireEvent.click(screen.getByText('Create'));
    });

    // Check that the button shows "Creating..."
    expect(screen.getByText('Creating...')).toBeInTheDocument();

    // Check that rotate button is disabled while creating
    const rotateButton = screen.getByTestId('rotate-btn-key1');
    expect(rotateButton).toHaveAttribute('aria-disabled', 'true');

    // Resolve the promise to complete the test
    await act(async () => {
      resolveCreate({
        prefix: 'new-prefix',
        full_key: 'new-full-key-1234567890'
      });
      // Wait for the promise to be processed
      await createPromise;
    });

    // Wait for the component to update
    await waitFor(() => {
      expect(screen.getByText('New API Key Created')).toBeInTheDocument();
    });
  });
});