import { createShopifyDashboardSession } from "@orbitcheck/contracts";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server.js";
import { generateShopifySessionToken, getOrbitcheckClient } from "../utils/orbitcheck.server.js";

const orbitcheckClient = getOrbitcheckClient();

/**
 * API route to create OrbitCheck dashboard session for Shopify merchant.
 * This endpoint:
 * 1. Authenticates the Shopify session
 * 2. Calls the OrbitCheck API to create a dashboard session
 * 3. Returns the dashboard URL for redirect
 */
export const action = async ({ request }: ActionFunctionArgs) => {
    try {
        // Authenticate the Shopify admin session to get session token
        const { session } = await authenticate.admin(request);

        if (!session?.shop) {
            return new Response(
                JSON.stringify({ error: "No active Shopify session" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        // Generate OrbitCheck session JWT
        const orbitcheckSessionToken = generateShopifySessionToken(session.shop);

        // Call OrbitCheck API to create dashboard session
        const response = await createShopifyDashboardSession({
            client: orbitcheckClient,
            headers: {
                'Authorization': `Bearer ${orbitcheckSessionToken}`,
            },
        });

        if (response.error) {
            console.error('Dashboard session creation failed:', response.error);
            return new Response(
                JSON.stringify({ error: response.error }),
                { status: response.response?.status || 500, headers: { "Content-Type": "application/json" } }
            );
        }

        // Extract Set-Cookie headers from API response
        // Use getSetCookie() if available, otherwise fall back to manual extraction
        let rawSetCookies: string[] = [];
        if (typeof response.response.headers.getSetCookie === 'function') {
            rawSetCookies = response.response.headers.getSetCookie();
        } else {
            // Fallback: manually extract all Set-Cookie headers
            const setCookieHeader = response.response.headers.get('set-cookie');
            if (setCookieHeader) {
                rawSetCookies = [setCookieHeader];
            }
        }

        // Check if cookies are present
        if (rawSetCookies.length === 0) {
            console.error('OrbitCheck API response missing Set-Cookie header');
            return new Response(
                JSON.stringify({ error: 'Session cookie missing' }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        // Forward cookies to the browser
        const headers = new Headers({ "Content-Type": "application/json" });
        rawSetCookies.forEach((value) => headers.append("Set-Cookie", value));

        // Return the dashboard URL and session info with cookies
        return new Response(
            JSON.stringify(response.data),
            { status: 200, headers }
        );
    } catch (error) {
        console.error('Failed to create dashboard session:', error);
        return new Response(
            JSON.stringify({ error: 'Failed to create dashboard session' }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};