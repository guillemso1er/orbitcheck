import { getShopifyShopSettings, updateShopifyShopSettings } from "@orbitcheck/contracts";
import { useEffect, useState } from "react";
import { useApiClient } from "../utils/api.js";

type Mode = 'disabled' | 'notify' | 'activated';

export default function Settings() {
    const [mode, setMode] = useState<Mode>('disabled');
    const [loading, setLoading] = useState(true);
    const apiClient = useApiClient();
    useEffect(() => {
        (async () => {
            try {
                const response = await getShopifyShopSettings({ client: apiClient });
                const data = response?.data;
                if (data?.mode) {
                    setMode(data.mode as Mode);
                }
            } catch (error) {
                console.error('Failed to fetch shop settings:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [apiClient]);

    async function onChange(event: Event & { currentTarget: { value: string } }) {
        const val = event.currentTarget.value;
        setMode(val as Mode);
        try {
            await updateShopifyShopSettings({
                client: apiClient,
                body: { mode: val as Mode }
            });
        } catch (error) {
            console.error('Failed to update shop settings:', error);
            // Optionally revert the mode change if the update failed
            setMode(mode);
        }
    }

    return (
        <s-page heading="Order validation">
            <s-section>
                <s-stack gap="large-400">
                    <s-text>Choose how OrbitCheck handles new orders.</s-text>
                    {loading ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '12px 0'
                        }}>
                            <s-spinner />
                            <s-text>Loading settings...</s-text>
                        </div>
                    ) : (
                        <s-select label="Mode" value={mode} onChange={onChange} disabled={loading}>
                            <s-choice value="disabled" selected={mode === 'disabled'}>Disabled</s-choice>
                            <s-choice value="notify" selected={mode === 'notify'}>Notify</s-choice>
                            <s-choice value="activated" selected={mode === 'activated'}>Activated</s-choice>
                        </s-select>
                    )}
                </s-stack>
            </s-section>
        </s-page>
    );
}