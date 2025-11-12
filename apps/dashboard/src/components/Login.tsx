import { createClient, loginUser, registerUser } from '@orbitcheck/contracts';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { API_BASE, ERROR_MESSAGES } from '../constants';
import ThemeToggle from './ThemeToggle';

// Icons (you can replace with actual icon libraries like lucide-react or heroicons)
const EyeIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EyeOffIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
);

const SpinnerIcon = () => (
  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

interface User {
  id: string;
  email: string;
}

interface LoginForm {
  email: string;
  password: string;
  confirm_password: string;
  rememberMe: boolean;
}

interface ValidationState {
  email: boolean;
  password: boolean;
  confirmPassword: boolean;
}

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
}

// Custom hook for password strength calculation
const usePasswordStrength = (password: string): PasswordStrength => {
  return useMemo(() => {
    if (!password) return { score: 0, label: '', color: 'bg-gray-300' };

    let score = 0;
    const checks = [
      password.length >= 8,
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /[0-9]/.test(password),
      /[^a-zA-Z0-9]/.test(password),
      password.length >= 12
    ];

    score = checks.filter(Boolean).length;

    const strengthLevels = [
      { min: 0, label: 'Very Weak', color: 'bg-red-500' },
      { min: 2, label: 'Weak', color: 'bg-orange-500' },
      { min: 3, label: 'Fair', color: 'bg-yellow-500' },
      { min: 4, label: 'Good', color: 'bg-blue-500' },
      { min: 5, label: 'Strong', color: 'bg-green-500' },
      { min: 6, label: 'Very Strong', color: 'bg-emerald-500' }
    ];

    const level = strengthLevels.reverse().find(l => score >= l.min) || strengthLevels[0];
    return { score: (score / 6) * 100, label: level.label, color: level.color };
  }, [password]);
};

// Custom hook for form validation
const useFormValidation = (_form: LoginForm, isRegister: boolean) => {
  const [validationState, setValidationState] = useState<ValidationState>({
    email: false,
    password: false,
    confirmPassword: false
  });

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LoginForm, string>>>({});

  const validateEmail = useCallback((email: string) => {
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    setValidationState(prev => ({ ...prev, email: isValid }));

    if (!email) {
      setFieldErrors(prev => ({ ...prev, email: 'Email is required' }));
      return false;
    }
    if (!isValid) {
      setFieldErrors(prev => ({ ...prev, email: 'Please enter a valid email' }));
      return false;
    }
    setFieldErrors(prev => ({ ...prev, email: undefined }));
    return true;
  }, []);

  const validatePassword = useCallback((password: string) => {
    const isValid = isRegister ? password.length >= 8 : password.length > 0;
    setValidationState(prev => ({ ...prev, password: isValid }));

    if (!password) {
      setFieldErrors(prev => ({ ...prev, password: 'Password is required' }));
      return false;
    }
    if (isRegister && password.length < 8) {
      setFieldErrors(prev => ({ ...prev, password: 'Password must be at least 8 characters' }));
      return false;
    }
    setFieldErrors(prev => ({ ...prev, password: undefined }));
    return true;
  }, [isRegister]);

  const validateConfirmPassword = useCallback((confirmPassword: string, password: string) => {
    if (!isRegister) return true;

    const isValid = confirmPassword === password && confirmPassword.length > 0;
    setValidationState(prev => ({ ...prev, confirmPassword: isValid }));

    if (!confirmPassword) {
      setFieldErrors(prev => ({ ...prev, confirm_password: 'Please confirm your password' }));
      return false;
    }
    if (confirmPassword !== password) {
      setFieldErrors(prev => ({ ...prev, confirm_password: 'Passwords do not match' }));
      return false;
    }
    setFieldErrors(prev => ({ ...prev, confirm_password: undefined }));
    return true;
  }, [isRegister]);

  return {
    validationState,
    fieldErrors,
    validateEmail,
    validatePassword,
    validateConfirmPassword
  };
};

const Login: React.FC = () => {
  const [form, setForm] = useState<LoginForm>({
    email: '',
    password: '',
    confirm_password: '',
    rememberMe: false
  });
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof LoginForm, boolean>>>({});

  const { login } = useAuth();
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);

  const passwordStrength = usePasswordStrength(form.password);
  const {
    validationState,
    fieldErrors,
    validateEmail,
    validatePassword,
    validateConfirmPassword
  } = useFormValidation(form, isRegister);

  // Focus email input on mount
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // Password requirements for display
  const passwordRequirements = useMemo(() => [
    { met: form.password.length >= 8, text: 'At least 8 characters' },
    { met: /[a-z]/.test(form.password), text: 'One lowercase letter' },
    { met: /[A-Z]/.test(form.password), text: 'One uppercase letter' },
    { met: /[0-9]/.test(form.password), text: 'One number' },
    { met: /[^a-zA-Z0-9]/.test(form.password), text: 'One special character' }
  ], [form.password]);

  const handleFieldChange = useCallback((field: keyof LoginForm, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError(null);

    // Real-time validation after field is touched
    if (touched[field]) {
      if (field === 'email') validateEmail(value);
      if (field === 'password') validatePassword(value);
      if (field === 'confirm_password') validateConfirmPassword(value, form.password);
    }
  }, [touched, form.password, validateEmail, validatePassword, validateConfirmPassword]);

  const handleFieldBlur = useCallback((field: keyof LoginForm) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    if (field === 'email') validateEmail(form.email);
    if (field === 'password') validatePassword(form.password);
    if (field === 'confirm_password') validateConfirmPassword(form.confirm_password, form.password);
  }, [form, validateEmail, validatePassword, validateConfirmPassword]);

  const validateForm = useCallback(() => {
    const emailValid = validateEmail(form.email);
    const passwordValid = validatePassword(form.password);
    const confirmValid = validateConfirmPassword(form.confirm_password, form.password);

    if (!emailValid || !passwordValid || (isRegister && !confirmValid)) {
      // Set first error as main error
      const firstError = fieldErrors.email || fieldErrors.password || fieldErrors.confirm_password;
      if (firstError) setError(firstError);
      return false;
    }

    setError(null);
    return true;
  }, [form, isRegister, validateEmail, validatePassword, validateConfirmPassword, fieldErrors]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all fields as touched
    setTouched({ email: true, password: true, confirm_password: true });

    if (!validateForm()) return;

    setLoading(true);
    setError(null);

    try {
      const apiClient = createClient({ baseUrl: API_BASE });

      let data;
      if (isRegister) {
        const response = await registerUser({
          client: apiClient,
          body: {
            email: form.email.trim().toLowerCase(),
            password: form.password,
            confirm_password: form.confirm_password,
          },
        });
        data = response.data;
      } else {
        const response = await loginUser({
          client: apiClient,
          body: {
            email: form.email.trim().toLowerCase(),
            password: form.password,
            rememberMe: form.rememberMe,
          },
        });
        data = response.data;
      }

      if (data && data.user) {
        const user: User = {
          id: data.user.id || '',
          email: data.user.email || ''
        };
        login(user, form.rememberMe);
        navigate('/api-keys');
      } else {
        throw new Error(ERROR_MESSAGES.INVALID_SERVER_RESPONSE);
      }
    } catch (err: any) {
      const errorMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        err.message ||
        ERROR_MESSAGES.UNEXPECTED_ERROR;
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const toggleAuthMode = () => {
    setIsRegister(!isRegister);
    setError(null);
    setTouched({});
    setForm({ email: '', password: '', confirm_password: '', rememberMe: false });
    setTimeout(() => emailRef.current?.focus(), 100);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-indigo-950 p-4">
      {/* Theme Toggle in top-right corner */}
      <div className="fixed top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        {/* Logo/Brand Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl shadow-lg mb-4">
            <span className="text-2xl font-bold text-white">O</span>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
            OrbitCheck
          </h1>
        </div>

        {/* Main Card */}
        <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 dark:border-gray-700/50 p-8 transition-all duration-500 hover:shadow-3xl">
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {isRegister ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {isRegister
                ? 'Start your journey with powerful validation tools'
                : 'Sign in to continue to your dashboard'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Email Field */}
            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email Address
              </label>
              <div className="relative">
                <input
                  ref={emailRef}
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => handleFieldChange('email', e.target.value)}
                  onBlur={() => handleFieldBlur('email')}
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                  className={`
                    w-full px-4 py-3 rounded-lg border-2 transition-all duration-200
                    placeholder:text-gray-400 dark:placeholder:text-gray-500
                    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
                    disabled:bg-gray-100 disabled:cursor-not-allowed
                    dark:bg-gray-700/50 dark:text-white
                    ${touched.email && fieldErrors.email
                      ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10'
                      : touched.email && validationState.email
                        ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }
                  `}
                />
                {touched.email && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {validationState.email ? (
                      <span className="text-green-500"><CheckIcon /></span>
                    ) : fieldErrors.email ? (
                      <span className="text-red-500"><XIcon /></span>
                    ) : null}
                  </div>
                )}
              </div>
              {touched.email && fieldErrors.email && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.email}</p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => handleFieldChange('password', e.target.value)}
                  onBlur={() => handleFieldBlur('password')}
                  placeholder={isRegister ? 'Min. 8 characters' : 'Enter your password'}
                  required
                  disabled={loading}
                  className={`
                    w-full px-4 py-3 pr-12 rounded-lg border-2 transition-all duration-200
                    placeholder:text-gray-400 dark:placeholder:text-gray-500
                    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
                    disabled:bg-gray-100 disabled:cursor-not-allowed
                    dark:bg-gray-700/50 dark:text-white
                    ${touched.password && fieldErrors.password
                      ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10'
                      : touched.password && validationState.password
                        ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }
                  `}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {touched.password && fieldErrors.password && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.password}</p>
              )}

              {/* Password Strength Indicator */}
              {isRegister && form.password && (
                <div className="space-y-2 mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Password Strength</span>
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                      style={{ width: `${passwordStrength.score}%` }}
                    />
                  </div>

                  {/* Password Requirements */}
                  <div className="grid grid-cols-1 gap-1 mt-2">
                    {passwordRequirements.map((req, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className={`text-xs ${req.met ? 'text-green-600' : 'text-gray-400'}`}>
                          {req.met ? <CheckIcon /> : <XIcon />}
                        </span>
                        <span className={`text-xs ${req.met ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-500'}`}>
                          {req.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password Field */}
            {isRegister && (
              <div className="space-y-1">
                <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirm_password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={form.confirm_password}
                    onChange={(e) => handleFieldChange('confirm_password', e.target.value)}
                    onBlur={() => handleFieldBlur('confirm_password')}
                    placeholder="Re-enter your password"
                    required
                    disabled={loading}
                    className={`
                      w-full px-4 py-3 pr-12 rounded-lg border-2 transition-all duration-200
                      placeholder:text-gray-400 dark:placeholder:text-gray-500
                      focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
                      disabled:bg-gray-100 disabled:cursor-not-allowed
                      dark:bg-gray-700/50 dark:text-white
                      ${touched.confirm_password && fieldErrors.confirm_password
                        ? 'border-red-500 bg-red-50/50 dark:bg-red-900/10'
                        : touched.confirm_password && validationState.confirmPassword
                          ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10'
                          : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                      }
                    `}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {touched.confirm_password && fieldErrors.confirm_password && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">{fieldErrors.confirm_password}</p>
                )}
              </div>
            )}

            {/* Remember Me & Forgot Password */}
            {!isRegister && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.rememberMe}
                    onChange={(e) => handleFieldChange('rememberMe', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Remember me</span>
                </label>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="text-red-500 mt-0.5"><XIcon /></span>
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !form.email || !form.password || (isRegister && !form.confirm_password)}
              className={`
                w-full py-3 px-4 rounded-lg font-medium text-white
                transition-all duration-200 transform
                ${loading || !form.email || !form.password || (isRegister && !form.confirm_password)
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0'
                }
                focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
                flex items-center justify-center gap-2
              `}
            >
              {loading ? (
                <>
                  <SpinnerIcon />
                  <span>Processing...</span>
                </>
              ) : (
                <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
              )}
            </button>

          </form>

          {/* Toggle Auth Mode */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {isRegister ? 'Already have an account?' : "Don't have an account?"}
              <button
                type="button"
                onClick={toggleAuthMode}
                disabled={loading}
                className="ml-1 font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors disabled:opacity-50"
              >
                {isRegister ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            By continuing, you agree to our{' '}
            <a href="https://orbitcheck.io/legal/tos.html" className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="https://orbitcheck.io/legal/privacy.html" className="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;