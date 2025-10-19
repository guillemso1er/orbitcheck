import { createApiClient } from '@orbitcheck/contracts';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { API_BASE, ERROR_MESSAGES, LOCAL_STORAGE_KEYS, VALIDATION_MESSAGES } from '../constants';

interface User {
  id: string;
  email: string;
}

/**
 * Login form state interface: Defines structure for email and password fields.
 */
interface LoginForm {
  email: string;
  password: string;
}

/**
 * Login component: Handles user authentication (login/register toggle) with form validation,
 * API calls to backend auth endpoints, error handling, and navigation on success.
 * Supports mode toggle between login and register, displays loading states and errors.
 * Integrates with AuthContext for token/user storage and protected route redirection.
 *
 * @returns {JSX.Element} Authentication form with inputs, submit button, toggle link, and inline styles.
 */
const Login: React.FC = () => {
  const [form, setForm] = useState<LoginForm>({ email: '', password: '' });
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  /**
   * Validates form inputs: Checks email format and password length (min 8 for register).
   * Updates error state with specific messages for invalid fields.
   * Clears previous errors on valid input.
   */
  const validateForm = () => {
    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError(VALIDATION_MESSAGES.INVALID_EMAIL);
      return false;
    }
    if (form.password.length < 8 && isRegister) {
      setError(VALIDATION_MESSAGES.PASSWORD_TOO_SHORT);
      return false;
    }
    if (!form.password) {
      setError(VALIDATION_MESSAGES.PASSWORD_REQUIRED);
      return false;
    }
    setError(null);
    return true;
  };

  /**
   * Handles form submission: Validates inputs, makes POST request to /auth/login or /auth/register,
   * extracts token/user from response, calls login from context, navigates to dashboard on success.
   * Catches network/API errors, sets user-friendly error message, handles loading state.
   *
   * @param e - React form submit event.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    setError(null);

    try {
      const apiClient = createApiClient({
        baseURL: API_BASE
      });

      let data;
      if (isRegister) {
        data = await apiClient.registerUser({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        });
      } else {
        data = await apiClient.loginUser({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        });
      }

      if (data.user) {
        // Ensure the user object matches the expected interface
        const user: User = {
          id: data.user.id || '',
          email: data.user.email || ''
        };
        // Store the auth token for API requests
        // For registration, use pat_token; for login, no token returned, rely on session
        const token = (data as any).pat_token || data.token;
        if (token) {
          localStorage.setItem(LOCAL_STORAGE_KEYS.AUTH_TOKEN, token);
        } else {
          throw new Error('No authentication token received');
        }
        login(token, user);
        navigate('/api-keys');
      } else {
        throw new Error(ERROR_MESSAGES.INVALID_SERVER_RESPONSE);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Toggles between login and register modes: Switches form title, button text, and validation rules.
   * Clears any existing error messages on toggle for clean UX.
   */
  const toggleAuthMode = () => {
    setIsRegister(!isRegister);
    setError(null);
    setForm({ email: '', password: '' }); // Reset form on toggle
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
          <p>{isRegister ? 'Join OrbiCheck to get started with validation tools' : 'Sign in to access your dashboard'}</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Enter your email"
              required
              aria-describedby={error ? "email-error" : undefined}
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">{isRegister ? 'Password (min 8 characters)' : 'Password'}</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Enter your password"
              required
              minLength={8}
              aria-describedby={error ? "password-error" : undefined}
              disabled={loading}
            />
          </div>
          {error && (
            <div id="auth-error" className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading || !form.email || !form.password}>
            {loading ? 'Processing...' : (isRegister ? 'Create Account' : 'Sign In')}
          </button>
        </form>
        <div className="auth-toggle">
          <p>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}
          </p>
          <button type="button" onClick={toggleAuthMode} className="toggle-link" disabled={loading}>
            {isRegister ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </div>
      <style>{`
        .auth-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: var(--spacing-md);
          background-color: var(--bg-secondary);
        }
        .auth-card {
          background: var(--bg-primary);
          padding: var(--spacing-xl);
          border-radius: var(--border-radius-lg);
          box-shadow: var(--shadow-md);
          width: 100%;
          max-width: 400px;
          border: 1px solid var(--border-color);
        }
        .auth-header {
          text-align: center;
          margin-bottom: var(--spacing-lg);
        }
        .auth-header h2 {
          margin-bottom: var(--spacing-sm);
          color: var(--text-primary);
        }
        .auth-header p {
          color: var(--text-secondary);
          margin: 0;
        }
        .auth-form {
          margin-bottom: var(--spacing-lg);
        }
        .form-group {
          margin-bottom: var(--spacing-md);
        }
        .form-group label {
          display: block;
          margin-bottom: var(--spacing-xs);
          font-weight: 500;
          color: var(--text-primary);
        }
        .form-group input {
          width: 100%;
          padding: var(--spacing-sm);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          font-size: 1rem;
        }
        .form-group input:focus {
          outline: none;
          border-color: var(--primary-color);
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }
        .form-group input:disabled {
          background-color: var(--bg-secondary);
          cursor: not-allowed;
        }
        .alert {
          padding: var(--spacing-sm) var(--spacing-md);
          margin-bottom: var(--spacing-md);
          border: 1px solid transparent;
          border-radius: var(--border-radius);
        }
        .alert-danger {
          color: #721c24;
          background-color: #f8d7da;
          border-color: #f5c6cb;
        }
        .btn-block {
          width: 100%;
        }
        .btn {
          padding: var(--spacing-md);
          border: none;
          border-radius: var(--border-radius);
          cursor: pointer;
          font-size: 1rem;
          font-weight: 500;
          transition: background-color 0.2s ease;
        }
        .btn-primary {
          background-color: var(--primary-color);
          color: white;
        }
        .btn-primary:hover:not(:disabled) {
          background-color: #0056b3;
        }
        .btn-primary:disabled {
          background-color: var(--bg-secondary);
          cursor: not-allowed;
        }
        .auth-toggle {
          text-align: center;
        }
        .auth-toggle p {
          margin: 0 0 var(--spacing-sm) 0;
          color: var(--text-secondary);
        }
        .toggle-link {
          background: none;
          border: none;
          color: var(--primary-color);
          text-decoration: underline;
          cursor: pointer;
          font-size: 1rem;
          padding: 0;
        }
        .toggle-link:hover:not(:disabled) {
          color: #0056b3;
        }
        .toggle-link:disabled {
          color: var(--text-secondary);
          cursor: not-allowed;
        }
        @media (max-width: 480px) {
          .auth-card {
            padding: var(--spacing-lg);
            margin: var(--spacing-sm);
          }
        }
      `}</style>
    </div>
  );
};

export default Login;