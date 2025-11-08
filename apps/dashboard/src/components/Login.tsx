import { createApiClient } from '@orbitcheck/contracts';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { API_BASE, ERROR_MESSAGES, LOCAL_STORAGE_KEYS, VALIDATION_MESSAGES } from '../constants';

interface User {
  id: string;
  email: string;
}

/**
 * Login form state interface: Defines structure for email, password, and confirm_password fields.
 */
interface LoginForm {
  email: string;
  password: string;
  confirm_password: string;
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
  const [form, setForm] = React.useState<LoginForm>({ email: '', password: '', confirm_password: '' });
  const [isRegister, setIsRegister] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  /**
   * Validates form inputs: Checks email format and password length (min 8 for register).
   * For register mode, also validates confirm_password matches password.
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
    if (isRegister && form.password !== form.confirm_password) {
      setError('Passwords do not match');
      return false;
    }
    if (isRegister && !form.confirm_password) {
      setError('Please confirm your password');
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
          confirm_password: form.confirm_password,
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
    } catch (err: any) {
      // Handle Axios errors with proper error message extraction
      if (err.response?.data?.error?.message) {
        setError(err.response.data.error.message);
      } else if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else if (err.message) {
        setError(err.message);
      } else {
        setError(ERROR_MESSAGES.UNEXPECTED_ERROR);
      }
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
    setForm({ email: '', password: '', confirm_password: '' }); // Reset form on toggle
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md p-8 space-y-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
          <p className="mt-2 text-sm text-gray-600">{isRegister ? 'Join OrbitCheck to get started with validation tools' : 'Sign in to access your dashboard'}</p>
        </div>
        <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email address"
                required
                disabled={loading}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">{isRegister ? 'Password (min 8 characters)' : 'Password'}</label>
              <input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={isRegister ? 'Password (min 8 characters)' : 'Password'}
                required
                minLength={8}
                disabled={loading}
                className={`appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 ${isRegister ? '' : 'rounded-b-md'} focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm`}
              />
            </div>
            {isRegister && (
              <div>
                <label htmlFor="confirm_password" className="sr-only">Confirm Password</label>
                <input
                  id="confirm_password"
                  type="password"
                  value={form.confirm_password}
                  onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                  placeholder="Confirm your password"
                  required
                  minLength={8}
                  disabled={loading}
                  className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                />
              </div>
            )}
          </div>

          {error && (
            <div id="auth-error" className="p-3 bg-red-50 border-l-4 border-red-400 text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}

          <div>
            <button id="btn-primary" type="submit" className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-gray-400 disabled:cursor-not-allowed" disabled={loading || !form.email || !form.password || (isRegister && !form.confirm_password)}>
              {loading ? 'Processing...' : (isRegister ? 'Create Account' : 'Sign In')}
            </button>
          </div>
        </form>
        <div className="text-sm text-center">
          <p className="text-gray-600">
            {isRegister ? 'Already have an account?' : "Don't have an account?"}
            <button type="button" onClick={toggleAuthMode} className="ml-1 font-medium text-indigo-600 hover:text-indigo-500 underline disabled:text-gray-400 disabled:cursor-not-allowed" disabled={loading}>
              {isRegister ? 'Sign In' : 'Create Account'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;