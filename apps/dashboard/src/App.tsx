import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, NavLink } from 'react-router-dom';
import { useAuth } from './AuthContext';
import ApiKeys from './components/ApiKeys';
import UsageDashboard from './components/UsageDashboard';
import LogExplorer from './components/LogExplorer';
import WebhookTester from './components/WebhookTester';
import Login from './components/Login';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <div>Loading...</div>;
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

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


  const navItems = [
    { path: '/api-keys', label: 'API Keys', icon: '🔑', component: <ApiKeys /> },
    { path: '/usage', label: 'Usage', icon: '📊', component: <UsageDashboard /> },
    { path: '/logs', label: 'Logs', icon: '📋', component: <LogExplorer /> },
    { path: '/webhooks', label: 'Webhooks', icon: '🪝', component: <WebhookTester /> },
  ];


  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleNavClick = () => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="app-layout">
      {/* Toggle button */}
      <button className={`mobile-menu-btn ${(isMobile || (!isMobile && !sidebarOpen)) ? '' : 'hidden'}`} onClick={toggleSidebar} aria-label="Toggle navigation menu">
        ☰
      </button>

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1 className="logo">OrbiCheck</h1>
          <button className="sidebar-close" onClick={toggleSidebar} aria-label="Close menu">×</button>
        </div>
        {isAuthenticated ? (
          <>
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
            <div className="sidebar-footer">
              <button onClick={() => { logout(); handleNavClick(); }} className="logout-btn" aria-label="Logout">Logout</button>
            </div>
          </>
        ) : (
          <div className="sidebar-login">
            <Link to="/login" className="login-link" onClick={handleNavClick}>Login</Link>
          </div>
        )}
      </aside>

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true"></div>}

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