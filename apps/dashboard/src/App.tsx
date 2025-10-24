import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import ApiKeys from './components/ApiKeys';
import BulkCsvTool from './components/BulkCsvTool';
import LogExplorer from './components/LogExplorer';
import Login from './components/Login';
import Rules from './components/Rules';
import ThemeToggle from './components/ThemeToggle';
import UsageDashboard from './components/UsageDashboard';
import WebhookTester from './components/WebhookTester';
import { UI_STRINGS } from './constants';

// Types
interface NavItem {
  path: string;
  label: string;
  icon: string;
  component: React.ComponentType;
}

// Constants
const MOBILE_BREAKPOINT = 768;

const NAV_ITEMS: NavItem[] = [
  { path: '/api-keys', label: UI_STRINGS.API_KEYS_MANAGEMENT, icon: '🔑', component: ApiKeys },
  { path: '/bulk-csv', label: UI_STRINGS.BULK_CSV_TOOL, icon: '📄', component: BulkCsvTool },
  { path: '/usage', label: UI_STRINGS.USAGE_DASHBOARD, icon: '📊', component: UsageDashboard },
  { path: '/logs', label: UI_STRINGS.LOG_EXPLORER, icon: '📋', component: LogExplorer },
  { path: '/rules', label: UI_STRINGS.RULES_EDITOR, icon: '⚖️', component: Rules },
  { path: '/webhooks', label: UI_STRINGS.WEBHOOK_TESTER, icon: '🪝', component: WebhookTester },
];

const getNavLinkClasses = (isActive: boolean) =>
  `nav-link flex items-center px-6 py-4 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors border-l-4 ${isActive
    ? 'bg-white dark:bg-gray-700 text-blue-600 border-blue-500 font-medium'
    : 'border-transparent hover:border-blue-500'
  }`;

/**
 * Protected route wrapper component
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="loading" role="status" aria-live="polite">
          {UI_STRINGS.LOADING}
        </div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Protected route content wrapper
 */
function RouteWrapper({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * Main App component
 */
function App() {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth > MOBILE_BREAKPOINT
  );
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT
  );

  // Handle responsive behavior
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (mobile !== isMobile) {
        setSidebarOpen(!mobile);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobile]);

  const toggleSidebar = () => setSidebarOpen(prev => !prev);

  const closeSidebarIfMobile = () => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleLogout = () => {
    logout();
    closeSidebarIfMobile();
    navigate('/login', { replace: true });
  };

  // Memoize sidebar classes
  const sidebarClasses = useMemo(
    () =>
      `fixed top-0 left-0 h-full w-64 bg-gray-100 dark:bg-gray-800 border-r border-gray-300 dark:border-gray-700 flex flex-col transition-transform duration-300 z-40 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`,
    [sidebarOpen]
  );

  const mainClasses = useMemo(
    () => `flex-1 transition-all duration-300 min-h-screen bg-white dark:bg-gray-900 ${sidebarOpen ? 'md:ml-64' : 'ml-0'}`,
    [sidebarOpen]
  );

  return (
    <div className="flex min-h-screen relative bg-white dark:bg-gray-900">
      {/* MODIFICATION: Menu "open" button now appears whenever sidebar is closed */}
      {!sidebarOpen && (
        <button
          id="menu-open-btn"
          className="fixed top-4 left-4 z-50 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-lg shadow-md"
          onClick={toggleSidebar}
          aria-label="Open navigation menu"
          aria-expanded={sidebarOpen}
        >
          ☰
        </button>
      )}

      {/* Sidebar */}
      <aside
        id="sidebar"
        className={sidebarClasses}
        aria-label="Main navigation sidebar"
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-300 dark:border-gray-700 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">OrbitCheck</h1>
          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <button
              id="sidebar-close"
              className="text-gray-500 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 p-2 rounded transition-colors text-2xl leading-none"
              onClick={toggleSidebar}
              aria-label="Close menu"
            >
              ×
            </button>
          </div>
        </div>

        {/* Navigation */}
        {isAuthenticated ? (
          <>
            <nav className="flex-1 py-4 overflow-y-auto" aria-label="Main navigation">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => getNavLinkClasses(isActive)}
                  onClick={closeSidebarIfMobile}
                >
                  <span className="mr-4 text-xl" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              ))}

              {/* API Docs Link */}
              <a
                href={`${window.location.origin}/api-reference`}
                target="_blank"
                rel="noopener noreferrer"
                className={getNavLinkClasses(false)}
                onClick={closeSidebarIfMobile}
              >
                <span className="mr-4 text-xl" aria-hidden="true">📖</span>
                <span className="font-medium">API Docs</span>
              </a>
            </nav>

            {/* Logout Button */}
            <div className="p-6 border-t border-gray-300 dark:border-gray-700">
              <button
                id="logout-btn"
                onClick={handleLogout}
                className="w-full bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
              >
                {UI_STRINGS.LOGOUT}
              </button>
            </div>
          </>
        ) : (
          <div className="p-6 border-t border-gray-300 dark:border-gray-700 text-center">
            <Link
              to="/login"
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
              onClick={closeSidebarIfMobile}
            >
              {UI_STRINGS.LOGIN}
            </Link>
          </div>
        )}
      </aside>

      {/* Mobile Overlay */}
      {isMobile && sidebarOpen && (
        <div
          id="sidebar-overlay"
          className="fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={closeSidebarIfMobile}
          aria-hidden="true"
        />
      )}

      {/* Main Content */}
      <main className={mainClasses}>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Generate protected routes from NAV_ITEMS */}
          {NAV_ITEMS.map(({ path, label, component: Component }) => (
            <Route
              key={path}
              path={path}
              element={
                <ProtectedRoute>
                  <RouteWrapper label={label}>
                    <Component />
                  </RouteWrapper>
                </ProtectedRoute>
              }
            />
          ))}

          {/* API Docs Route */}
          <Route
            path="/api-docs"
            element={
              <ProtectedRoute>
                <RouteWrapper label="API Documentation">
                  <iframe
                    src={`${window.location.origin}/api-reference`}
                    className="w-full border-0"
                    style={{ height: 'calc(100vh - 60px)' }}
                    title="API Documentation"
                  />
                </RouteWrapper>
              </ProtectedRoute>
            }
          />

          {/* Default redirect */}
          <Route path="/" element={<Navigate to="/api-keys" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;