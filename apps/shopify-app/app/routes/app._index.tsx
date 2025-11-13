import { BlockStack, Card, InlineStack, Page, SegmentedControl, Text } from '@shopify/polaris';
import { useEffect, useState } from 'react';

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

    async function onChange(val: string) {
        setMode(val as Mode);
        await fetch('https://api.orbitcheck.io/integrations/shopify/api/shop-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: val }),
        });
    }

    return (
        <Page title="Order validation">
            <Card>
                <BlockStack gap="400">
                    <Text as="p">Choose how OrbitCheck handles new orders.</Text>
                    <InlineStack>
                        <SegmentedControl
                            segments={[
                                { id: 'disabled', label: 'Disabled' },
                                { id: 'notify', label: 'Notify' },
                                { id: 'activated', label: 'Activated' },
                            ]}
                            selected={mode}
                            onChange={onChange}
                            disabled={loading}
                        />
                    </InlineStack>
                </BlockStack>
            </Card>
        </Page>
    );
}