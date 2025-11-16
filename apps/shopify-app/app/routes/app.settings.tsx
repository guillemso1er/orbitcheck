import { getShopifyShopSettings, updateShopifyShopSettings } from "@orbitcheck/contracts";
import { useEffect, useState } from "react";

type Mode = 'disabled' | 'notify' | 'activated';

export default function Settings() {
    const [mode, setMode] = useState<Mode>('disabled');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const response = await getShopifyShopSettings();
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
    }, []);

    async function onChange(event: Event & { currentTarget: { value: string } }) {
        const val = event.currentTarget.value;
        setMode(val as Mode);
        try {
            await updateShopifyShopSettings({
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
                    <s-text >Choose how OrbitCheck handles new orders.</s-text>
                    <s-select label="Mode" value={mode} onChange={onChange}>
                        <s-choice value="disabled" selected={mode === 'disabled'}>Disabled</s-choice>
                        <s-choice value="notify" selected={mode === 'notify'}>Notify</s-choice>
                        <s-choice value="activated" selected={mode === 'activated'}>Activated</s-choice>
                    </s-select>
                </s-stack>
            </s-section>
        </s-page>
    );
}