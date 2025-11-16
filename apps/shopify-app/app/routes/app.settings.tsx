import { useEffect, useState } from "react";

type Mode = 'disabled' | 'notify' | 'activated';

export default function Settings() {
    const [mode, setMode] = useState<Mode>('disabled');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const res = await fetch('https://api.orbitcheck.io/integrations/shopify/api/shop-settings');
            if (res.ok) {
                const json = await res.json();
                setMode((json?.mode as Mode) ?? 'disabled');
            }
            setLoading(false);
        })();
    }, []);

    async function onChange(event: Event & { currentTarget: { value: string } }) {
        const val = event.currentTarget.value;
        setMode(val as Mode);
        await fetch('https://api.orbitcheck.io/integrations/shopify/api/shop-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: val }),
        });
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