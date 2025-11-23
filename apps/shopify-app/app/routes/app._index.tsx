import { createShopifyDashboardSession, getShopifyShopSettings, updateShopifyShopSettings } from "@orbitcheck/contracts";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { useApiClient } from "../utils/api.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [mode, setMode] = useState<'disabled' | 'notify' | 'activated'>('disabled');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const apiClient = useApiClient();

  useEffect(() => {
    // Check app status and settings
    const checkStatus = async () => {
      setLoading(true);
      try {
        const response = await getShopifyShopSettings({ client: apiClient });
        const data = response?.data;
        if (data?.mode) {
          setMode(data.mode);
          setStatus('connected');
        } else {
          setStatus('disconnected');
        }
      } catch (error) {
        setStatus('error');
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
  }, [apiClient]);

  const updateMode = async (newMode: 'disabled' | 'notify' | 'activated') => {
    try {
      await updateShopifyShopSettings({
        client: apiClient,
        body: { mode: newMode }
      });
      setMode(newMode);
    } catch (error) {
      console.error('Failed to update mode:', error);
    }
  };

  const openDashboard = async () => {
    setDashboardLoading(true);
    try {
      const response = await createShopifyDashboardSession({ client: apiClient });
      const data = response.data;

      // Redirect to the dashboard URL
      window.open(data?.dashboard_url, '_blank');
    } catch (error) {
      console.error('Failed to open dashboard:', error);
      alert('Failed to open OrbitCheck Dashboard. Please try again.');
    } finally {
      setDashboardLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connected': return 'success';
      case 'disconnected': return 'warning';
      case 'error': return 'critical';
      default: return 'base';
    }
  };

  return (
    <s-page heading="OrbitCheck Dashboard">
      <s-section>
        <s-stack gap="large-400">
          <s-text>
            Welcome to OrbitCheck! This app helps you validate customer information
            and detect high-risk orders automatically.
          </s-text>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>App Status:</span>
            <span
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: getStatusColor() === 'success' ? '#d1fae5' :
                  getStatusColor() === 'warning' ? '#fef3c7' :
                    getStatusColor() === 'critical' ? '#fee2e2' : '#e5e7eb',
                color: '#1f2937'
              }}
            >
              {status || 'Unknown'}
            </span>
          </div>

          {loading && (
            <div style={{
              width: '100%',
              height: '20px',
              backgroundColor: '#e5e7eb',
              borderRadius: '4px',
              animation: 'pulse 1.5s ease-in-out infinite'
            }} />
          )}

          {!loading && (
            <>
              <hr style={{ margin: '16px 0', border: 'none', borderBottom: '1px solid #e5e7eb' }} />

              {/* Dashboard Access */}
              <div style={{
                padding: '16px',
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{ marginTop: '0', marginBottom: '8px' }}>OrbitCheck Dashboard</h3>
                <p style={{ margin: '0 0 12px 0', color: '#6b7280' }}>
                  Access your full OrbitCheck dashboard to view analytics, manage settings, and configure advanced features.
                </p>
                <button
                  onClick={openDashboard}
                  disabled={dashboardLoading}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: dashboardLoading ? '#9ca3af' : '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: '500',
                    cursor: dashboardLoading ? 'not-allowed' : 'pointer',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    if (!dashboardLoading) {
                      e.currentTarget.style.backgroundColor = '#1d4ed8';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!dashboardLoading) {
                      e.currentTarget.style.backgroundColor = '#2563eb';
                    }
                  }}
                >
                  {dashboardLoading ? 'Opening...' : 'Open OrbitCheck Dashboard →'}
                </button>
              </div>

              <hr style={{ margin: '16px 0', border: 'none', borderBottom: '1px solid #e5e7eb' }} />

              <div>
                <label htmlFor="mode-select" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                  Order Validation Mode
                </label>
                <select
                  id="mode-select"
                  value={mode}
                  onChange={(e) => updateMode(e.target.value as any)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    backgroundColor: 'white'
                  }}
                >
                  <option value="disabled">Disabled - No validation will be performed</option>
                  <option value="notify">Notify - Validate orders and add tags, but don&apos;t block</option>
                  <option value="activated">Activated - Full validation with blocking capabilities</option>
                </select>
              </div>


            </>
          )}

          <hr style={{ margin: '16px 0', border: 'none', borderBottom: '1px solid #e5e7eb' }} />
          <h3 style={{ marginTop: '0', marginBottom: '8px' }}>How it works</h3>
          <ul style={{ margin: '0', paddingLeft: '20px' }}>
            <li>New orders are automatically validated against OrbitCheck&apos;s  data validation algorithms</li>
            <li>High-risk orders are tagged with appropriate risk indicators</li>
          </ul>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
