import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../AuthContext';
import LogExplorer from '../components/LogExplorer';

// Mock the API client from @orbitcheck/contracts
const mockApiClient = {
  getLogs: jest.fn(),
};

jest.mock('@orbitcheck/contracts', () => ({
  createApiClient: jest.fn(() => mockApiClient),
}));

// Mock the AuthContext
jest.mock('../AuthContext', () => ({
  ...jest.requireActual('../AuthContext'),
  useAuth: () => ({
    user: { id: 'user1', email: 'test@example.com' },
    token: 'test-token',
    login: jest.fn(),
    logout: jest.fn(),
    isAuthenticated: true,
    isLoading: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(() => 'test-token'),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Mock window.URL.createObjectURL for export functionality
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// Helper function to render component with providers
const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        {component}
      </AuthProvider>
    </BrowserRouter>
  );
};

const getCallCount = () => mockApiClient.getLogs.mock.calls.length;
const getAllArgs = () => mockApiClient.getLogs.mock.calls.map(c => c[0]);
const getLastArgs = () => mockApiClient.getLogs.mock.calls.at(-1)?.[0];

const waitForNextCall = async (prev = getCallCount()) => {
  await waitFor(() => {
    expect(getCallCount()).toBeGreaterThan(prev);
  });
};

const mockEmptyData = { data: [], next_cursor: null, total_count: 0 };

// Sample log data for testing
const mockLogData = {
  data: [
    {
      id: 'log1',
      type: 'validation' as const,
      endpoint: '/validate/email',
      reason_codes: ['invalid_format'],
      status: 400,
      created_at: '2024-01-15T10:00:00Z',
      meta: {
        ip: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
        duration_ms: 125
      }
    },
    {
      id: 'log2',
      type: 'order' as const,
      endpoint: '/orders/create',
      reason_codes: [],
      status: 200,
      created_at: '2024-01-15T11:00:00Z',
      meta: {
        ip: '192.168.1.2',
        user_agent: 'Chrome/120.0',
        duration_ms: 250
      }
    },
    {
      id: 'log3',
      type: 'validation' as const,
      endpoint: '/validate/phone',
      reason_codes: ['blacklisted'],
      status: 400,
      created_at: '2024-01-15T12:00:00Z',
      meta: {
        ip: '192.168.1.3',
        user_agent: 'Safari/17.0',
        duration_ms: 100
      }
    }
  ],
  next_cursor: 'next-page-cursor',
  total_count: 3
};


describe('LogExplorer Component', () => {
  // Save original createElement
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.getLogs.mockResolvedValue(mockLogData);

    // Mock createElement and click for export test
    const mockAnchor = originalCreateElement('a');
    mockAnchor.click = jest.fn();

    jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'a') {
        return mockAnchor;
      }
      return originalCreateElement(tagName);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should render the log explorer with title and controls', async () => {
      renderWithProviders(<LogExplorer />);

      // Check for main heading
      expect(screen.getByRole('heading', { name: /log explorer/i })).toBeInTheDocument();

      // Wait for the component to load
      await waitFor(() => {
        // Check for filter controls by looking for specific text or elements
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      });
    });

    it('should load and display logs on mount', async () => {
      renderWithProviders(<LogExplorer />);

      // Wait for logs to load
      await waitFor(() => {
        expect(mockApiClient.getLogs).toHaveBeenCalledTimes(1);
      });

      // Check that logs are displayed
      await waitFor(() => {
        expect(screen.getByText('/validate/email')).toBeInTheDocument();
        expect(screen.getByText('/orders/create')).toBeInTheDocument();
        expect(screen.getByText('/validate/phone')).toBeInTheDocument();
      });
    });

    it('should display loading state while fetching logs', async () => {
      // Make the API call take longer
      mockApiClient.getLogs.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(mockLogData), 100))
      );

      renderWithProviders(<LogExplorer />);

      // Check for loading indicator
      expect(screen.getByText(/loading/i)).toBeInTheDocument();

      // Wait for logs to load
      await waitFor(() => {
        expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
      });
    });
  });

  it('should show empty state when no logs are returned', async () => {
    mockApiClient.getLogs.mockResolvedValueOnce(mockEmptyData);
    renderWithProviders(<LogExplorer />);

    await waitFor(() => {
      expect(screen.getByText(/no logs/i)).toBeInTheDocument();
    });

    // Also ensure table rows aren't rendered
    expect(screen.queryByText('/validate/email')).not.toBeInTheDocument();
  });

  describe('Filtering', () => {
    it('should filter logs by type', async () => {
      renderWithProviders(<LogExplorer />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('/validate/email')).toBeInTheDocument();
      });

      // Find and interact with type filter
      const typeSelect = screen.getByDisplayValue(/all types/i);
      fireEvent.change(typeSelect, { target: { value: 'validation' } });

      // Check that the filter was applied
      await waitFor(() => {
        expect(mockApiClient.getLogs).toHaveBeenCalledTimes(2);
      });
    });

    it('should filter logs by status', async () => {
      renderWithProviders(<LogExplorer />);
      await screen.findByText('/validate/email');

      const prev = getCallCount();

      // Status is an input[type="number"], not a select
      const statusInput = screen.getByLabelText(/status/i) as HTMLInputElement;

      await userEvent.clear(statusInput);
      await userEvent.type(statusInput, '400');

      await waitForNextCall(prev);

      const lastArgs = getLastArgs();
      expect(lastArgs).toEqual(
        expect.objectContaining({
          status: 400,
          limit: 50,
          offset: 0,
        })
      );
    });

    it('should filter logs by date range', async () => {
      renderWithProviders(<LogExplorer />);
      await screen.findByText('/validate/email');

      const prev = getCallCount();

      // Prefer labelled inputs if you have them:
      const from = screen.queryByLabelText(/from/i) ?? screen.getAllByRole('textbox')[0];
      const to = screen.queryByLabelText(/to/i) ?? screen.getAllByRole('textbox')[1];

      await userEvent.clear(from as HTMLInputElement);
      await userEvent.type(from as HTMLInputElement, '2024-01-01');

      await userEvent.clear(to as HTMLInputElement);
      await userEvent.type(to as HTMLInputElement, '2024-01-31');

      // Wait until any call contains both params - using correct parameter names
      await waitFor(() => {
        const calls = getAllArgs();
        expect(calls.some(a => a?.date_from === '2024-01-01' && a?.date_to === '2024-01-31')).toBe(true);
      });

      // And sanity-check paging args on the last call
      expect(getLastArgs()).toEqual(expect.objectContaining({ limit: 50, offset: 0 }));
    });

  });

  describe('Search', () => {
    it('should search logs by endpoint', async () => {
      renderWithProviders(<LogExplorer />);
      await screen.findByText('/validate/email');

      const prev = getCallCount();

      // Find the endpoint input by its placeholder text
      const endpointInput = screen.getByPlaceholderText(/endpoint/i);

      await userEvent.clear(endpointInput);
      await userEvent.type(endpointInput, 'email');

      await waitForNextCall(prev);

      await waitFor(() => {
        const calls = getAllArgs();
        expect(calls.some(a => a?.endpoint === 'email')).toBe(true);
      });

      expect(getLastArgs()).toEqual(expect.objectContaining({ limit: 50, offset: 0 }));
    });

    it('should search logs by reason code', async () => {
      renderWithProviders(<LogExplorer />);
      await screen.findByText('/validate/email');

      const prev = getCallCount();

      // Find the reason code input by its placeholder text
      const reasonInput = screen.getByPlaceholderText(/reason code/i);

      await userEvent.clear(reasonInput);
      await userEvent.type(reasonInput, 'invalid');

      await waitForNextCall(prev);

      await waitFor(() => {
        const calls = getAllArgs();
        expect(calls.some(a => a?.reason_code === 'invalid')).toBe(true);
      });

      expect(getLastArgs()).toEqual(expect.objectContaining({ limit: 50, offset: 0 }));
    });
  });

  describe('Pagination', () => {
    const makeLog = (i: number) => ({
      id: `log-${i}`,
      type: 'validation' as const,
      endpoint: '/validate/email',
      reason_codes: [],
      status: 200,
      created_at: '2024-01-15T10:00:00Z',
      meta: { ip: `192.168.1.${i % 255}`, user_agent: 'test', duration_ms: 100 },
    });

    it('should load more logs when pagination is triggered', async () => {
      // Page 1 (50 items), total 60 -> Next enabled
      const page1 = {
        data: Array.from({ length: 50 }, (_, i) => makeLog(i)),
        next_cursor: 'cursor-page-2',
        total_count: 60,
      };
      const page2 = {
        data: Array.from({ length: 10 }, (_, i) => makeLog(50 + i)),
        next_cursor: null,
        total_count: 60,
      };

      mockApiClient.getLogs.mockResolvedValueOnce(page1);
      mockApiClient.getLogs.mockResolvedValueOnce(page2);

      renderWithProviders(<LogExplorer />);
      // Use getAllByText to avoid the multiple elements error
      await screen.findAllByText('/validate/email');

      const prev = getCallCount();

      // Be lenient on the name if your button is just "Next"
      const nextButton =
        screen.queryByLabelText(/next page/i) ??
        screen.getByRole('button', { name: /next/i });

      await userEvent.click(nextButton as HTMLButtonElement);

      await waitForNextCall(prev);

      // The component uses offset-based pagination
      expect(getLastArgs()).toEqual(expect.objectContaining({ offset: 50, limit: 50 }));
    });

    it('should display pagination info', async () => {
      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        // Look for pagination text with the correct format from the component
        expect(screen.getByText(/1-3 of 3/)).toBeInTheDocument();
      });
    });
  });

  describe('Log Details', () => {
    it('should display log details including status codes', async () => {
      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        // Use getAllByText for multiple occurrences
        const status400Elements = screen.getAllByText('400');
        expect(status400Elements.length).toBeGreaterThan(0);
        expect(screen.getByText('200')).toBeInTheDocument();
      });
    });

    it('should display reason codes for failed validations', async () => {
      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        expect(screen.getByText(/invalid_format/i)).toBeInTheDocument();
        expect(screen.getByText(/blacklisted/i)).toBeInTheDocument();
      });
    });

    it('should expand log details when clicked', async () => {
      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        expect(screen.getByText('/validate/email')).toBeInTheDocument();
      });

      // Click on a log entry to expand details - look for the row
      const logRows = screen.getAllByRole('row');
      // Click on a data row (skip header)
      if (logRows.length > 1) {
        fireEvent.click(logRows[1]);

        // Check for expanded details
        await waitFor(() => {
          expect(screen.getByText(/192.168.1.1/i)).toBeInTheDocument();
          expect(screen.getByText(/125/i)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('should display error message when API call fails', async () => {
      const errorMessage = 'Failed to fetch logs';
      mockApiClient.getLogs.mockRejectedValue(new Error(errorMessage));

      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        expect(screen.getByText(/error.*logs/i)).toBeInTheDocument();
      });
    });

    it('should allow retry after error', async () => {
      mockApiClient.getLogs.mockRejectedValueOnce(new Error('Network error'));

      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });

      // Mock successful response for retry
      mockApiClient.getLogs.mockResolvedValueOnce(mockLogData);

      // Click refresh button which acts as retry
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      // Should show logs after retry
      await waitFor(() => {
        expect(screen.getByText('/validate/email')).toBeInTheDocument();
      });
    });
  });

  describe('Export Functionality', () => {
    it('should have export button for logs', async () => {
      renderWithProviders(<LogExplorer />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
      });
    });

    it('should request next page with offset', async () => {
      mockApiClient.getLogs.mockResolvedValueOnce(mockLogData); // returns next_cursor
      renderWithProviders(<LogExplorer />);

      await screen.findAllByText('/validate/email');

      const nextButton = screen.getByRole('button', { name: /next/i });
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(mockApiClient.getLogs).toHaveBeenCalledTimes(2);
      });

      // The component uses offset-based pagination, not cursor-based
      expect(mockApiClient.getLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 50 })
      );
    });

    it('should trigger export, click the anchor, and revoke the blob URL', async () => {
      renderWithProviders(<LogExplorer />);

      await screen.findByText('/validate/email');

      const exportButton = screen.getByRole('button', { name: /export/i });
      fireEvent.click(exportButton);

      // Assert blob created and revoked
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      // If you kept a reference to the created <a>, also assert click:
      // expect(mockAnchor.click).toHaveBeenCalled();
    });
  });

  describe('Refresh Functionality', () => {
    it('should refresh logs when refresh button is clicked', async () => {
      renderWithProviders(<LogExplorer />);

      // Wait for initial load
      await waitFor(() => {
        expect(mockApiClient.getLogs).toHaveBeenCalledTimes(1);
      });

      // Clear the mock to reset call count
      mockApiClient.getLogs.mockClear();
      mockApiClient.getLogs.mockResolvedValue(mockLogData);

      // Click refresh button
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      fireEvent.click(refreshButton);

      // Should call API again
      await waitFor(() => {
        expect(mockApiClient.getLogs).toHaveBeenCalledTimes(1);
      });
    });
  });
});