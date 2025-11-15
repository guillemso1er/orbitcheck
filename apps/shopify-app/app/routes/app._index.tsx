import { BlockStack, Card, InlineStack, Page,  Tabs, Text } from '@shopify/polaris';
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
                        <Tabs
                            tabs={[
                                { id: 'disabled', content: 'Disabled' },
                                { id: 'notify', content: 'Notify' },
                                { id: 'activated', content: 'Activated' },
                            ]}
                            selected={['disabled', 'notify', 'activated'].indexOf(mode)}
                            onSelect={(index) => {
                                if (loading) return;
                                const newMode = (['disabled', 'notify', 'activated'][index] as Mode);
                                console.debug('Tabs.onSelect', { index, newMode });
                                onChange(newMode);
                            }}
                        />
                    </InlineStack>
                </BlockStack>
            </Card>
        </Page>
    );
}