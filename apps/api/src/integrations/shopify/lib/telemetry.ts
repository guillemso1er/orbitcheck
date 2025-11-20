import { PostHog } from 'posthog-node';

import { environment } from '../../../environment.js';

const telemetryClient = environment.POSTHOG_KEY ? new PostHog(environment.POSTHOG_KEY, { host: environment.POSTHOG_HOST }) : null;

export async function shutdownShopifyTelemetry(): Promise<void> {
    if (!telemetryClient) return;
    const asyncShutdown = (telemetryClient as any).shutdownAsync || (telemetryClient as any).shutdown;
    if (typeof asyncShutdown === 'function') {
        await asyncShutdown.call(telemetryClient);
        return;
    }
    const flush = (telemetryClient as any).flush;
    if (typeof flush === 'function') {
        await flush.call(telemetryClient);
    }
}

export function captureShopifyEvent(shop: string, event: string, properties: Record<string, unknown> = {}): void {
    if (!telemetryClient) return;
    try {
        telemetryClient.capture({
            distinctId: shop,
            event,
            properties: { shop, ...properties },
        });
    } catch (error) {
        // Avoid crashing the request if telemetry fails
        console.warn('Failed to capture PostHog event', error);
    }
}