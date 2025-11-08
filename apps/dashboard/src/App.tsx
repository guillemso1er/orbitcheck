import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import ApiKeys from './components/ApiKeys';
import BulkCsvTool from './components/BulkCsvTool';
import LogExplorer from './components/LogExplorer';
import Login from './components/Login';
import PersonalAccessTokens from './components/PersonalAccessTokens';
import Rules from './components/rules/Rules';
import ThemeToggle from './components/ThemeToggle';
import UsageDashboard from './components/UsageDashboard';
import WebhookTester from './components/WebhookTester';
import { API_BASE, UI_STRINGS } from './constants';

// Types
interface NavItem {
  path: string;
  label: string;
  icon: string;
  component: React.ComponentType;
  badge?: string;
}

// Constants
const MOBILE_BREAKPOINT = 768;
const SIDEBAR_WIDTH = 280;

const NAV_ITEMS: NavItem[] = [
  { path: '/api-keys', label: UI_STRINGS.API_KEYS_MANAGEMENT, icon: '🔑', component: ApiKeys },
  { path: '/personal-access-tokens', label: UI_STRINGS.PERSONAL_ACCESS_TOKENS, icon: '🛡️', component: PersonalAccessTokens },
  { path: '/bulk-csv', label: UI_STRINGS.BULK_CSV_TOOL, icon: '📄', component: BulkCsvTool },
  { path: '/usage', label: UI_STRINGS.USAGE_DASHBOARD, icon: '📊', component: UsageDashboard },
  { path: '/logs', label: UI_STRINGS.LOG_EXPLORER, icon: '📋', component: LogExplorer },
  { path: '/rules', label: UI_STRINGS.RULES_EDITOR, icon: '⚖️', component: Rules },
  { path: '/webhooks', label: UI_STRINGS.WEBHOOK_TESTER, icon: '🪝', component: WebhookTester },
];

/**
 * Loading spinner component
 */
const LoadingSpinner = memo(() => (
  <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
    <div className="relative">
      <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 dark:border-t-blue-400"></div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse"></div>
      </div>
    </div>
    <span className="ml-4 text-gray-600 dark:text-gray-400 font-medium">{UI_STRINGS.LOADING}</span>
  </div>
));

/**
 * Navigation item component
 */
const NavigationItem = memo(({
  item,
  isActive,
  onClick
}: {
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
}) => (
  <NavLink
    to={item.path}
    className={`
      group relative flex items-center px-6 py-3.5 
      text-gray-700 dark:text-gray-300 
      hover:bg-gradient-to-r hover:from-blue-50 hover:to-transparent 
      dark:hover:from-gray-700 dark:hover:to-transparent
      transition-all duration-200 ease-in-out
      ${isActive
        ? 'bg-gradient-to-r from-blue-50 to-transparent dark:from-gray-700 dark:to-transparent text-blue-600 dark:text-blue-400 font-semibold'
        : 'hover:text-gray-900 dark:hover:text-white'
      }
    `}
    onClick={onClick}
  >
    {/* Active indicator */}
    <div className={`
      absolute left-0 top-0 h-full w-1 bg-blue-500 dark:bg-blue-400 
      transform transition-transform duration-200 origin-left
      ${isActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}
    `} />

    {/* Icon */}
    <span className={`
      mr-3 text-xl transform transition-transform duration-200
      ${isActive ? 'scale-110' : 'group-hover:scale-110'}
    `} aria-hidden="true">
      {item.icon}
    </span>

    {/* Label */}
    <span className="flex-1">{item.label}</span>

    {/* Badge if present */}
    {item.badge && (
      <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 rounded-full">
        {item.badge}
      </span>
    )}

    {/* Hover arrow */}
    <span className={`
      ml-2 transform transition-all duration-200
      ${isActive ? 'translate-x-1 opacity-100' : 'translate-x-0 opacity-0 group-hover:translate-x-1 group-hover:opacity-100'}
    `}>
      →
    </span>
  </NavLink>
));

/**
 * Sidebar component
 */
const Sidebar = memo(({
  isOpen,
  isMobile,
  onClose,
  onLogout
}: {
  isOpen: boolean;
  isMobile: boolean;
  onClose: () => void;
  onLogout: () => void;
}) => {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  const closeSidebarIfMobile = useCallback(() => {
    if (isMobile) onClose();
  }, [isMobile, onClose]);

  return (
    <>
      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-white dark:bg-gray-900 
          border-r border-gray-200 dark:border-gray-800
          flex flex-col transition-transform duration-300 ease-in-out z-40
          shadow-xl
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ width: `${SIDEBAR_WIDTH}px` }}
        aria-label="Main navigation sidebar"
      >
        {/* Header - REDESIGNED */}
        <div className="relative">
          {/* Logo and Title Section */}
          <div className="p-6 pb-4">
            <div className="flex items-center space-x-3">
              {/* Better Logo */}
              <div className="relative">
                <div className="w-11 h-11 bg-gray-200 dark:bg-gray-600 rounded-xl flex items-center justify-center shadow-lg transform rotate-3 hover:rotate-6 transition-transform duration-300">
                  <img
                    src="/favicon.svg"
                    className="w-10 h-10 transform -rotate-3 "
                    alt="OrbitCheck logo"
                  />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900 animate-pulse"></div>
              </div>

              {/* Title */}
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  OrbitCheck
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  API Management
                </p>
              </div>
            </div>
          </div>

          {/* Controls Section */}
          <div className="px-6 pb-4 flex items-center justify-between">
            {/* Close button - only on mobile */}
            {isMobile && (
              <button
                className="
                  p-2.5 rounded-xl
                  bg-gray-100 dark:bg-gray-800
                  hover:bg-gray-200 dark:hover:bg-gray-700
                  text-gray-500 dark:text-gray-400
                  hover:text-gray-700 dark:hover:text-gray-200
                  transition-all duration-200
                  group
                "
                onClick={onClose}
                aria-label="Close menu"
              >
                <svg className="w-5 h-5 transform group-hover:rotate-90 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Divider with gradient */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center px-6">
              <div className="w-full border-t border-gray-200 dark:border-gray-800"></div>
            </div>
            <div className="relative flex justify-center">
              <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent"></div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        {isAuthenticated ? (
          <>
            <nav className="flex-1 py-2 overflow-y-auto custom-scrollbar" aria-label="Main navigation">
              <div className="space-y-1 px-3">
                {NAV_ITEMS.map((item) => (
                  <NavigationItem
                    key={item.path}
                    item={item}
                    isActive={location.pathname === item.path}
                    onClick={closeSidebarIfMobile}
                  />
                ))}

                {/* Divider */}
                <div className="my-4 mx-6 border-t border-gray-200 dark:border-gray-800" />

                {/* API Docs Link */}
                <a
                  href={`${API_BASE}/documentation`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="
                    group flex items-center px-6 py-3.5 
                    text-gray-700 dark:text-gray-300
                    hover:bg-gradient-to-r hover:from-purple-50 hover:to-transparent 
                    dark:hover:from-gray-700 dark:hover:to-transparent
                    hover:text-gray-900 dark:hover:text-white
                    transition-all duration-200
                  "
                  onClick={closeSidebarIfMobile}
                >
                  <span className="mr-3 text-xl group-hover:scale-110 transform transition-transform duration-200">📖</span>
                  <span className="flex-1">API Documentation</span>
                  <svg className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </nav>

            {/* Theme Toggle before user section */}
            <div className="px-4 py-3 flex justify-center">
              <ThemeToggle />
            </div>

            {/* User section */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={onLogout}
                className="
                  w-full flex items-center justify-center space-x-2
                  bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700
                  hover:from-red-50 hover:to-red-100 dark:hover:from-red-900/20 dark:hover:to-red-800/20
                  text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400
                  px-4 py-2.5 rounded-lg transition-all duration-200 font-medium
                  shadow-sm hover:shadow-md
                "
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>{UI_STRINGS.LOGOUT}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="p-6 text-center">
            <Link
              to="/login"
              className="
                inline-flex items-center justify-center space-x-2
                px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600
                hover:from-blue-600 hover:to-purple-700
                text-white font-medium rounded-lg
                shadow-lg hover:shadow-xl
                transition-all duration-200 transform hover:scale-105
              "
              onClick={closeSidebarIfMobile}
            >
              <span>{UI_STRINGS.LOGIN}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}
      </aside>

      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
});

/**
 * Menu toggle button
 */
const MenuToggle = memo(({ isOpen, onClick }: { isOpen: boolean; onClick: () => void }) => (
  <button
    className={`
      fixed top-4 left-4 z-50
      bg-white dark:bg-gray-900 
      border border-gray-200 dark:border-gray-700
      rounded-lg px-3 py-2 
      shadow-lg hover:shadow-xl
      transition-all duration-200 transform hover:scale-105
      ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}
    `}
    onClick={onClick}
    aria-label="Open navigation menu"
    aria-expanded={isOpen}
  >
    <svg className="w-6 h-6 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  </button>
));

/**
 * Protected route wrapper component
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Main App component
 */
function App() {
  const { logout } = useAuth();
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

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const handleLogout = useCallback(() => {
    logout();
    if (isMobile) closeSidebar();
    navigate('/login', { replace: true });
  }, [logout, isMobile, closeSidebar, navigate]);

  // Memoize main content classes
  const mainClasses = useMemo(
    () => `
      flex-1 transition-all duration-300 min-h-screen 
      bg-gradient-to-br from-gray-50 to-gray-100 
      dark:from-gray-900 dark:to-gray-800
      ${sidebarOpen && !isMobile ? `ml-[${SIDEBAR_WIDTH}px]` : 'ml-0'}
    `,
    [sidebarOpen, isMobile]
  );

  return (
    <div className="flex min-h-screen relative">
      <MenuToggle isOpen={sidebarOpen} onClick={toggleSidebar} />

      <Sidebar
        isOpen={sidebarOpen}
        isMobile={isMobile}
        onClose={closeSidebar}
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <main
        className={mainClasses}
        style={{ marginLeft: sidebarOpen && !isMobile ? `${SIDEBAR_WIDTH}px` : 0 }}
      >
        <div className="container mx-auto p-6">
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* Generate protected routes from NAV_ITEMS */}
            {NAV_ITEMS.map(({ path, label, component: Component }) => (
              <Route
                key={path}
                path={path}
                element={
                  <ProtectedRoute>
                    <div className="animate-fadeIn" role="region" aria-label={label}>
                      <Component />
                    </div>
                  </ProtectedRoute>
                }
              />
            ))}

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/api-keys" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;