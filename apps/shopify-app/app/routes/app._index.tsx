import {
  createShopifyDashboardSession,
  getShopifyShopSettings,
  updateShopifyShopSettings
} from "@orbitcheck/contracts";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { useApiClient } from "../utils/api.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

type Mode = 'disabled' | 'notify' | 'activated';
type Status = 'connected' | 'disconnected' | 'error';

export default function Index() {
  const shopify = useAppBridge();
  const apiClient = useApiClient();

  // State Management
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>('disconnected');
  const [mode, setMode] = useState<Mode>('disabled');
  const [dashboardLoading, setDashboardLoading] = useState(false);

  // Initial Data Load
  useEffect(() => {
    const checkStatus = async () => {
      setLoading(true);
      try {
        const response = await getShopifyShopSettings({ client: apiClient });
        const data = response?.data;
        if (data?.mode) {
          setMode(data.mode as Mode);
          setStatus('connected');
        } else {
          setStatus('disconnected');
        }
      } catch (error) {
        console.error('Failed to fetch shop settings:', error);
        setStatus('error');
      } finally {
        setLoading(false);
      }
    };
    checkStatus();
  }, [apiClient]);

  // Logic Handlers
  const handleUpdateMode = async (event: Event & { currentTarget: { value: string } }) => {
    const newMode = event.currentTarget.value as Mode;
    setMode(newMode); // Optimistic UI
    try {
      await updateShopifyShopSettings({
        client: apiClient,
        body: { mode: newMode }
      });
      shopify.toast.show("Settings saved successfully");
    } catch (error) {
      console.error('Failed to update mode:', error);
      shopify.toast.show("Failed to save settings", { isError: true });
    }
  };

  const handleOpenDashboard = async () => {
    setDashboardLoading(true);
    try {
      const response = await createShopifyDashboardSession({ client: apiClient });
      const data = response.data;
      if (data?.dashboard_url) {
        window.open(data.dashboard_url, '_blank');
      }
    } catch (error) {
      console.error('Failed to open dashboard:', error);
      shopify.toast.show("Could not open Dashboard", { isError: true });
    } finally {
      setDashboardLoading(false);
    }
  };

  // Render Loading State
  if (loading) {
    return (
      <s-page>
        <s-section>
          <s-stack gap="large-400">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
              <s-spinner />
              <s-text>Loading...</s-text>
            </div>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  // Render Main Interface
  return (
    <s-page heading="OrbitCheck Dashboard">
      <s-section>
        <s-stack gap="large-400">
          {/* Intro Text */}
          <s-text>
            Welcome to OrbitCheck! This app helps you validate customer information
            and detect high-risk orders automatically.
          </s-text>

          {/* Status Banners */}
          {status === 'connected' && (
            <s-banner tone="success" heading="Protected">
              OrbitCheck is active and monitoring your shop for fraud.
            </s-banner>
          )}

          {status === 'disconnected' && (
            <s-banner tone="warning" heading="Not Connected">
              Please check your API configuration to enable protection.
            </s-banner>
          )}

          {status === 'error' && (
            <s-banner tone="critical" heading="Connection Error">
              We are having trouble communicating with OrbitCheck servers.
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {/* Dashboard Action Card */}
      {status !== 'disconnected' && (
        <s-section heading="Dashboard Access">
          <s-stack gap="large-400">
            <s-text>
              Access your full OrbitCheck dashboard to view analytics, manage settings, and configure advanced features.
            </s-text>
            <s-button
              variant="primary"
              loading={dashboardLoading || undefined}
              onClick={handleOpenDashboard}
            >
              Open OrbitCheck Dashboard
            </s-button>
          </s-stack>
        </s-section>
      )}

      {/* Configuration Card */}
      {status !== 'disconnected' && (
        <s-section heading="Configuration">
          <s-stack gap="large-400">
            <s-select label="Order Validation Mode" value={mode} onChange={handleUpdateMode}>
              <s-choice value="disabled" selected={mode === 'disabled'}>Disabled - No validation</s-choice>
              <s-choice value="notify" selected={mode === 'notify'}>Notify - Tag high-risk orders</s-choice>
              <s-choice value="activated" selected={mode === 'activated'}>Activated - Block high-risk orders</s-choice>
            </s-select>

            <s-text tone="neutral">
              {mode === 'disabled' && "Validation is currently turned off."}
              {mode === 'notify' && "We will tag orders but not interfere with checkout."}
              {mode === 'activated' && "High-risk orders will be automatically blocked."}
            </s-text>
          </s-stack>
        </s-section>
      )}

      {/* Info Section */}
      {status !== 'disconnected' && (
        <s-section slot="aside" heading="How it works">
          <s-unordered-list>
            <s-list-item>New orders are automatically validated against OrbitCheck's algorithms.</s-list-item>
            <s-list-item>High-risk orders are tagged with appropriate risk indicators.</s-list-item>
          </s-unordered-list>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};