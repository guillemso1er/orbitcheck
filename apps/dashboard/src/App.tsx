import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, NavLink } from 'react-router-dom';
import { useAuth } from './AuthContext';
import ApiKeys from './components/ApiKeys';
import UsageDashboard from './components/UsageDashboard';
import LogExplorer from './components/LogExplorer';
import WebhookTester from './components/WebhookTester';
import Login from './components/Login';

/**
 * ProtectedRoute component: Enforces authentication for child routes.
 * Displays loading if auth state is pending, redirects to login if not authenticated,
 * renders children if user is authenticated. Enhances app security by protecting sensitive routes.
 *
 * @param {Object} props - Props object.
 * @param {React.ReactNode} props.children - JSX elements to render when authenticated.
 * @returns {JSX.Element|null} Loading div, children, or Navigate component.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <div className="loading">Loading...</div>;
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/**
 * Main App component: renders the dashboard layout with responsive sidebar navigation,
 * protected routes, and authentication-based content. Manages sidebar state for mobile/desktop,
 * listens to window resize for responsive behavior, handles navigation and logout.
 * Defines navigation items with icons, labels, paths, and lazy-loaded components.
 *
 * @returns {JSX.Element} Root dashboard layout with sidebar, main content, and routes.
 */
/**
 * Main App component: Orchestrates the dashboard UI with responsive sidebar, navigation,
 * protected routes, and authentication logic. Manages state for sidebar visibility and mobile detection,
 * listens to resize events for adaptive layout, handles logout and navigation interactions.
 * Defines navItems array for menu configuration and route mapping.
 *
 * @returns {JSX.Element} Complete dashboard layout including sidebar, overlay, main content, and routes.
 */
function App() {
  const { isAuthenticated, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 769px)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSidebarOpen(e.matches);
      setIsMobile(!e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  /**
   * Navigation menu items: Configuration array for sidebar links and routes.
   * Each item includes path, label, icon (emoji), and component for lazy rendering.
   * Enables easy addition of new dashboard sections.
   */
  const navItems = [
    { path: '/api-keys', label: 'API Keys', icon: '🔑', component: <ApiKeys /> },
    { path: '/usage', label: 'Usage', icon: '📊', component: <UsageDashboard /> },
    { path: '/logs', label: 'Logs', icon: '📋', component: <LogExplorer /> },
    { path: '/webhooks', label: 'Webhooks', icon: '🪝', component: <WebhookTester /> },
  ];

  /**
   * Toggles the sidebar visibility state: Opens if closed, closes if open.
   * Used by mobile menu button and sidebar close button for consistent UX.
   */
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  /**
   * Closes sidebar on navigation link click for mobile devices.
   * Improves usability by hiding menu after selection on small screens.
   */
  const handleNavClick = () => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="app-layout">
      {/* Mobile hamburger menu button: Displays on mobile or when sidebar is closed on desktop */}
      <button className={`mobile-menu-btn ${(isMobile || (!isMobile && !sidebarOpen)) ? '' : 'hidden'}`} onClick={toggleSidebar} aria-label="Toggle navigation menu">
        ☰
      </button>

      {/* Sidebar: Persistent navigation drawer with conditional open state for mobile */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1 className="logo">OrbiCheck</h1>
          <button className="sidebar-close" onClick={toggleSidebar} aria-label="Close menu">×</button>
        </div>
        {isAuthenticated ? (
          <>
            {/* Authenticated user navigation: Role="navigation" for accessibility */}
            <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={handleNavClick}
                  role="link"
                  aria-current="page"
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            {/* Logout section: Secure logout with state cleanup */}
            <div className="sidebar-footer">
              <button onClick={() => { logout(); handleNavClick(); }} className="logout-btn" aria-label="Logout">Logout</button>
            </div>
          </>
        ) : (
          {/* Guest access: Direct link to login page */}
          <div className="sidebar-login">
            <Link to="/login" className="login-link" onClick={handleNavClick}>Login</Link>
          </div>
        )}
      </aside>

      {/* Overlay for mobile sidebar: Closes menu on background click */}
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true"></div>}

      {/* Main content: Shifts left on desktop sidebar open, full width on mobile */}
      <main className={`main-content ${sidebarOpen ? 'open' : 'closed'}`} role="main">
        <Routes>
          <Route path="/login" element={<Login />} />
          {navItems.map((item) => (
            <Route
              key={item.path}
              path={item.path}
              element={
                <ProtectedRoute>
                  <div role="region" aria-label={item.label}>
                    {item.component}
                  </div>
                </ProtectedRoute>
              }
            />
          ))}
          <Route path="/" element={<Navigate to="/api-keys" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;