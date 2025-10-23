import React, { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext';
import ApiKeys from './components/ApiKeys';
import BulkCsvTool from './components/BulkCsvTool';
import LogExplorer from './components/LogExplorer';
import Login from './components/Login';
import Rules from './components/Rules';
import UsageDashboard from './components/UsageDashboard';
import WebhookTester from './components/WebhookTester';
import { UI_STRINGS } from './constants';

/**
 * @function ProtectedRoute
 * @description Enforces authentication for child routes, displaying a loading indicator
 * or redirecting to the login page as needed.
 * @param {object} props - The properties for the component.
 * @param {React.ReactNode} props.children - The child elements to render upon successful authentication.
 * @returns {JSX.Element|null} A loading indicator, the authenticated child components, or a redirect.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading">{UI_STRINGS.LOADING}</div>;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * @function App
 * @description The main application component that sets up the dashboard layout,
 * including a responsive sidebar and protected routing.
 * @returns {JSX.Element} The root layout of the application with a sidebar, main content, and defined routes.
 */
function App() {
  const { isAuthenticated, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      setSidebarOpen(!mobile);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const navItems = [
    { path: '/api-keys', label: UI_STRINGS.API_KEYS_MANAGEMENT, icon: '🔑', component: ApiKeys },
    { path: '/bulk-csv', label: UI_STRINGS.BULK_CSV_TOOL, icon: '📄', component: BulkCsvTool },
    { path: '/usage', label: UI_STRINGS.USAGE_DASHBOARD, icon: '📊', component: UsageDashboard },
    { path: '/logs', label: UI_STRINGS.LOG_EXPLORER, icon: '📋', component: LogExplorer },
    { path: '/rules', label: UI_STRINGS.RULES_EDITOR, icon: '⚖️', component: Rules },
    { path: '/webhooks', label: UI_STRINGS.WEBHOOK_TESTER, icon: '🪝', component: WebhookTester },
  ];

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleNavClick = () => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="app-layout">
      <button
        className={`mobile-menu-btn ${!sidebarOpen ? '' : 'hidden'}`}
        onClick={toggleSidebar}
        aria-label="Toggle navigation menu"
      >
        ☰
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1 className="logo">OrbitCheck</h1>
          <button className="sidebar-close" onClick={toggleSidebar} aria-label="Close menu">×</button>
        </div>
        {isAuthenticated ? (
          <>
            <nav className="sidebar-nav" aria-label="Main navigation">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={handleNavClick}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
              <a
                href={`${window.location.origin}/api-reference`}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-link"
                onClick={handleNavClick}
              >
                <span className="nav-icon" aria-hidden="true">📖</span>
                <span className="nav-label">API Docs</span>
              </a>
            </nav>
            <div className="sidebar-footer">
              <button onClick={() => { logout(); handleNavClick(); }} className="logout-btn">{UI_STRINGS.LOGOUT}</button>
            </div>
          </>
        ) : (
          <div className="sidebar-login">
            <Link to="/login" className="login-link" onClick={handleNavClick}>{UI_STRINGS.LOGIN}</Link>
          </div>
        )}
      </aside>

      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <main className={`main-content ${sidebarOpen ? 'open' : 'closed'}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/api-keys"
            element={
              <ProtectedRoute>
                <div role="region" aria-label={UI_STRINGS.API_KEYS_MANAGEMENT}>
                  <ApiKeys />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/bulk-csv"
            element={
              <ProtectedRoute>
                <div role="region" aria-label={UI_STRINGS.BULK_CSV_TOOL}>
                  <BulkCsvTool />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/usage"
            element={
              <ProtectedRoute>
                <div role="region" aria-label={UI_STRINGS.USAGE_DASHBOARD}>
                  <UsageDashboard />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/logs"
            element={
              <ProtectedRoute>
                <div role="region" aria-label={UI_STRINGS.LOG_EXPLORER}>
                  <LogExplorer />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/rules"
            element={
              <ProtectedRoute>
                <div role="region" aria-label={UI_STRINGS.RULES_EDITOR}>
                  <Rules />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/webhooks"
            element={
              <ProtectedRoute>
                <div role="region" aria-label={UI_STRINGS.WEBHOOK_TESTER}>
                  <WebhookTester />
                </div>
              </ProtectedRoute>
            }
          />
          <Route
            path="/api-docs"
            element={
              <ProtectedRoute>
                <div role="region" aria-label="API Documentation">
                  <iframe
                    src={`${window.location.origin}/api-reference`}
                    style={{ width: '100%', height: 'calc(100vh - 60px)', border: 'none' }}
                    title="API Documentation"
                  />
                </div>
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/api-keys" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;