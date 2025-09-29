import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

interface LoginForm {
  email: string;
  password: string;
}

const Login: React.FC = () => {
  const [form, setForm] = useState<LoginForm>({ email: '', password: '' });
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Authentication failed');
      }

      const data = await response.json();
      login(data.token, data.user);
      navigate('/api-keys');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const toggleAuthMode = () => {
    setIsRegister(!isRegister);
    setError(null);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>{isRegister ? 'Create Account' : 'Welcome Back'}</h2>
          <p>{isRegister ? 'Join OrbiCheck to get started' : 'Sign in to your account'}</p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
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
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">{isRegister ? 'Password (min 8 chars)' : 'Password'}</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Enter your password"
              required
              minLength={8}
              aria-describedby={error ? "password-error" : undefined}
            />
          </div>
          {error && (
            <div id="auth-error" className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Processing...' : (isRegister ? 'Create Account' : 'Sign In')}
          </button>
        </form>
        <div className="auth-toggle">
          <p>
            {isRegister ? 'Already have an account?' : "Don't have an account?"}
          </p>
          <button type="button" onClick={toggleAuthMode} className="toggle-link">
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
          color: #007bff;
          text-decoration: underline;
          cursor: pointer;
          font-size: 1rem;
          padding: 0;
        }
        .toggle-link:hover {
          color: #0056b3;
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