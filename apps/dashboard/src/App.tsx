import React, { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
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

  const handleLogout = () => {
    logout();
    handleNavClick();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen relative">
      <button
        id="mobile-menu-btn"
        className={`fixed top-4 left-4 z-50 md:hidden ${!sidebarOpen ? 'block' : 'hidden'} bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-lg`}
        onClick={toggleSidebar}
        aria-label="Toggle navigation menu"
      >
        ☰
      </button>

      <aside id="sidebar" className={`fixed top-0 left-0 h-full w-64 bg-gray-100 dark:bg-gray-800 border-r border-gray-300 dark:border-gray-700 flex flex-col transition-transform duration-300 z-40 transform ${sidebarOpen ? 'translate-x-0 open' : '-translate-x-full'} md:translate-x-0`} style={{ pointerEvents: sidebarOpen ? 'auto' : 'none' }}>
        <div className="p-6 border-b border-gray-300 dark:border-gray-700 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">OrbitCheck</h1>
          <button id="sidebar-close" className="hidden md:block text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 p-2 rounded transition-colors" onClick={toggleSidebar} aria-label="Close menu">×</button>
        </div>
        {isAuthenticated ? (
          <>
            <nav className="flex-1 py-4 overflow-y-auto" aria-label="Main navigation">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  id={`nav-link-${item.path.replace('/', '')}`}
                  to={item.path}
                  className={({ isActive }) => `nav-link flex items-center px-6 py-4 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors border-l-4 border-transparent hover:border-blue-500 ${isActive ? 'bg-white dark:bg-gray-700 text-blue-600 border-blue-500 font-medium' : ''}`}
                  onClick={handleNavClick}
                >
                  <span className="mr-4 text-xl" aria-hidden="true">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              ))}
              <a
                href={`${window.location.origin}/api-reference`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center px-6 py-4 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors border-l-4 border-transparent hover:border-blue-500"
                onClick={handleNavClick}
              >
                <span className="mr-4 text-xl" aria-hidden="true">📖</span>
                <span className="font-medium">API Docs</span>
              </a>
            </nav>
            <div className="p-6 border-t border-gray-300 dark:border-gray-700">
              <button id="logout-btn" onClick={handleLogout} className="w-full justify-start bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">{UI_STRINGS.LOGOUT}</button>
            </div>
          </>
        ) : (
          <div className="p-6 border-t border-gray-300 dark:border-gray-700 text-center">
            <Link to="/login" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium" onClick={handleNavClick}>{UI_STRINGS.LOGIN}</Link>
          </div>
        )}
      </aside>

      {isMobile && sidebarOpen && <div id="sidebar-overlay" className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} style={{ pointerEvents: 'auto' }} />}

      <main className={`flex-1 ml-0 transition-all duration-300 min-h-screen bg-white dark:bg-gray-900 md:ml-64`}>
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