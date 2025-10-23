import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Login from '../components/Login';

// Import these after the module resolution is set up
import '../constants';

// Mock the AuthContext
jest.mock('../AuthContext');

// Mock createApiClient from @orbitcheck/contracts
const mockApiClient = {
  getUsage: jest.fn(),
  getLogs: jest.fn(),
  getApiKeys: jest.fn(),
  listApiKeys: jest.fn(),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  testWebhook: jest.fn(),
  batchValidateData: jest.fn(),
  batchDedupeData: jest.fn(),
  getJobStatus: jest.fn(),
  evaluateOrder: jest.fn(),
  loginUser: jest.fn().mockResolvedValue({
    token: 'test-token',
    user: { id: 'user-id', email: 'test@example.com' }
  })
};

// Mock the entire @orbitcheck/contracts module
jest.mock('@orbitcheck/contracts', () => ({
  ...jest.requireActual('@orbitcheck/contracts'),
  createApiClient: jest.fn(() => mockApiClient),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

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

// Mock useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// UPDATED: Adapt renderWithRouter to use v7 future flags
const renderWithRouter = (component: React.ReactElement) => {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {component}
    </BrowserRouter>
  );
};

describe('Login Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();

    // Default mock implementation
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      login: jest.fn(),
      logout: jest.fn(),
      isAuthenticated: false,
      isLoading: false,
    });
  });

  // ... all of your tests remain exactly the same ...
  // No other changes are needed below this line.

  it('should render login form', () => {
    renderWithRouter(<Login />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should toggle to register mode', () => {
    renderWithRouter(<Login />);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    const toggleToRegisterButton = screen.getByRole('button', { name: /create account/i });

    fireEvent.click(toggleToRegisterButton);

    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should validate email format', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
    renderWithRouter(<Login />);

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(passwordInput, { target: { value: 'password123' } });

    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/please enter a valid email address/i)).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.queryByText(/please enter a valid email address/i)).not.toBeInTheDocument();
    });
  });

  it('should validate password length in register mode', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    );
    renderWithRouter(<Login />);

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password \(min 8 characters\)/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    fireEvent.change(passwordInput, { target: { value: 'short' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/password must be at least 8 characters long/i)).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: 'long-enough-password' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.queryByText(/password must be at least 8 characters long/i)).not.toBeInTheDocument();
    });
  });

  it('should call login function with correct credentials and navigate', async () => {
    const mockLogin = jest.fn();
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      login: mockLogin,
      logout: jest.fn(),
      isAuthenticated: false,
      isLoading: false,
    });

    // Mock the API client
    const { createApiClient } = require('@orbitcheck/contracts');
    const mockApiClient = {
      loginUser: jest.fn().mockResolvedValue({
        token: 'test-token',
        user: { id: 'user-id', email: 'test@example.com' }
      })
    };
    (createApiClient as jest.Mock).mockReturnValue(mockApiClient);

    renderWithRouter(<Login />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test-token', {
        id: 'user-id',
        email: 'test@example.com',
      });
      expect(mockNavigate).toHaveBeenCalledWith('/api-keys');
    });
  });

  it('should show loading state during submission', async () => {
    const mockLogin = jest.fn();
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      login: mockLogin,
      logout: jest.fn(),
      isAuthenticated: false,
      isLoading: false,
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => new Promise(resolve => setTimeout(() => resolve({
        token: 'test-token',
        user: { id: 'user-id', email: 'test@example.com' }
      }), 100)),
    });

    renderWithRouter(<Login />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByRole('button', { name: /processing.../i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /processing.../i })).not.toBeInTheDocument();
    });
  });

  it('should display error message on failed submission', async () => {
    const mockLogin = jest.fn();
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      login: mockLogin,
      logout: jest.fn(),
      isAuthenticated: false,
      isLoading: false,
    });

    // Mock the API client to throw an error
    const { createApiClient } = require('@orbitcheck/contracts');
    const mockApiClient = {
      loginUser: jest.fn().mockRejectedValue(new Error('Invalid credentials'))
    };
    (createApiClient as jest.Mock).mockReturnValue(mockApiClient);

    renderWithRouter(<Login />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/Invalid credentials/i)).toBeInTheDocument();
  });
});