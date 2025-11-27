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
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>('disconnected');
  const [mode, setMode] = useState<Mode>('disabled');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Client-only mounting to avoid hydration issues with web components
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initial Data Load
  useEffect(() => {
    if (!mounted) return;

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
  }, [apiClient, mounted]);




  // Logic Handlers
  const handleModeChange = (event: Event & { currentTarget: { value: string } }) => {
    const newMode = event.currentTarget.value as Mode;
    setPendingMode(newMode);
    setShowConfirmModal(true);
  };

  const handleConfirmModeChange = async () => {
    if (!pendingMode) return;
    setMode(pendingMode); // Optimistic UI
    setShowConfirmModal(false);
    try {
      await updateShopifyShopSettings({
        client: apiClient,
        body: { mode: pendingMode }
      });
      shopify.toast.show("Settings saved successfully");
    } catch (error) {
      console.error('Failed to update mode:', error);
      shopify.toast.show("Failed to save settings", { isError: true });
    } finally {
      setPendingMode(null);
    }
  };

  const handleCancelModeChange = () => {
    setPendingMode(null);
    setShowConfirmModal(false);
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

  // Don't render web components during SSR to avoid hydration mismatch
  if (!mounted || loading) {
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
    <s-page heading="OrbitCheck">
      <s-section>
        <s-stack gap="large-400">
          {/* Status Banners */}
          {status === 'connected' && (
            <s-banner tone="success" heading="Connected">
              OrbitCheck is online and ready to process orders.
            </s-banner>
          )}

          {status === 'disconnected' && (
            <s-banner tone="warning" heading="Not Connected">
              Unable to connect. Please reinstall the app or contact support.
            </s-banner>
          )}

          {status === 'error' && (
            <s-banner tone="critical" heading="Connection Error">
              Unable to reach OrbitCheck servers. Please try again later.
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {/* Dashboard Action Card */}
      {status !== 'disconnected' && (
        <s-section heading="Full Dashboard">
          <s-stack gap="large-400">
            <s-text>
              View order history, configure custom rules, manage API keys, and access detailed analytics.
            </s-text>
            <s-button
              variant="primary"
              loading={dashboardLoading || undefined}
              onClick={handleOpenDashboard}
            >
              Open Dashboard
            </s-button>
          </s-stack>
        </s-section>
      )}

      {/* Configuration Card */}
      {status !== 'disconnected' && (
        <s-section heading="Validation Mode">
          <s-stack gap="large-400">
            <s-select label="Choose how orders are processed" value={mode} onChange={handleModeChange}>
              <s-option value="disabled" selected={mode === 'disabled'}>Disabled</s-option>
              <s-option value="notify" selected={mode === 'notify'}>Notify Only</s-option>
              <s-option value="activated" selected={mode === 'activated'}>Full Protection</s-option>
            </s-select>

            <s-text tone="neutral">
              {mode === 'disabled' && "Orders are not being validated. Enable a mode to start."}
              {mode === 'notify' && "Orders are validated and risk tags are added, but no actions are taken. Useful for testing."}
              {mode === 'activated' && "Orders are validated, tagged, and problematic addresses trigger customer emails with a correction link."}
            </s-text>
          </s-stack>
        </s-section>
      )}

      {/* What It Does Section */}
      {status !== 'disconnected' && (
        <s-section slot="aside" heading="What OrbitCheck Does">
          <s-stack gap="large-400">
            <s-text variant="headingSm">When an order is placed:</s-text>
            <s-unordered-list>
              <s-list-item>Validates the shipping address for deliverability</s-list-item>
              <s-list-item>Checks for duplicate customers and addresses</s-list-item>
              <s-list-item>Detects disposable emails, P.O. boxes, and virtual addresses</s-list-item>
              <s-list-item>Calculates a risk score based on multiple signals</s-list-item>
              <s-list-item>Applies risk tags to the order in Shopify</s-list-item>
            </s-unordered-list>

            <s-text variant="headingSm">In Full Protection mode:</s-text>
            <s-unordered-list>
              <s-list-item>Sends an email to customers with invalid addresses</s-list-item>
              <s-list-item>Holds fulfillment until the address is corrected</s-list-item>
              <s-list-item>Updates the order when the customer confirms their address</s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-section>
      )}

      {/* Tags Reference Section */}
      {status !== 'disconnected' && (
        <s-section heading="Order Tags Reference">
          <s-stack gap="large-400">
            <s-text tone="neutral">
              These tags are automatically added to orders based on validation results:
            </s-text>

            <s-stack gap="base">
              <s-text variant="headingSm">Workflow Tags</s-text>
              <s-unordered-list>
                <s-list-item><strong>⏳ Validation: Pending</strong> - Waiting for customer to confirm address</s-list-item>
                <s-list-item><strong>✅ Validation: Verified</strong> - Address confirmed by customer</s-list-item>
                <s-list-item><strong>❌ Validation: Failed</strong> - Customer did not confirm in time</s-list-item>
              </s-unordered-list>
            </s-stack>

            <s-stack gap="base">
              <s-text variant="headingSm">Risk Indicators</s-text>
              <s-unordered-list>
                <s-list-item><strong>👥 Risk: Duplicate Customer</strong> - Similar customer already exists</s-list-item>
                <s-list-item><strong>🏠 Risk: Duplicate Address</strong> - Address used by another customer</s-list-item>
                <s-list-item><strong>🔄 Risk: Duplicate Order</strong> - Same order submitted multiple times</s-list-item>
                <s-list-item><strong>📮 Risk: P.O. Box</strong> - Shipping to a P.O. Box</s-list-item>
                <s-list-item><strong>🏢 Risk: Virtual Address</strong> - Mail forwarding service detected</s-list-item>
                <s-list-item><strong>📍 Risk: Invalid Address</strong> - Address could not be verified</s-list-item>
                <s-list-item><strong>📧 Risk: Disposable Email</strong> - Temporary email service used</s-list-item>
                <s-list-item><strong>💵 Risk: COD Payment</strong> - Cash on delivery order</s-list-item>
                <s-list-item><strong>🚨 Risk: High RTO</strong> - High likelihood of return-to-origin</s-list-item>
                <s-list-item><strong>💰 Risk: High Value</strong> - Order exceeds value threshold</s-list-item>
              </s-unordered-list>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <s-modal
          heading="Change Validation Mode"
          onHide={handleCancelModeChange}
        >
          <s-text>
            {pendingMode === 'disabled' && "Are you sure you want to disable order validation? Orders will no longer be checked."}
            {pendingMode === 'notify' && "Switch to Notify Only mode? Orders will be validated and tagged, but no actions will be taken."}
            {pendingMode === 'activated' && "Enable Full Protection? Customers with invalid addresses will receive correction emails and fulfillment will be held."}
          </s-text>
          <s-button slot="secondary-actions" onClick={handleCancelModeChange}>
            Cancel
          </s-button>
          <s-button slot="primary-action" variant="primary" onClick={handleConfirmModeChange}>
            Confirm
          </s-button>
        </s-modal>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};