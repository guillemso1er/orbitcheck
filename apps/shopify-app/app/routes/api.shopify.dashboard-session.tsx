import { createShopifyDashboardSession } from "@orbitcheck/contracts";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server.js";
import { getOrbitcheckClient } from "../utils/orbitcheck.server.js";

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
        const { session, sessionToken } = await authenticate.admin(request);

        if (!session?.shop) {
            return new Response(
                JSON.stringify({ error: "No active Shopify session" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        if (!sessionToken) {
            return new Response(
                JSON.stringify({ error: "Missing session token" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        // Call OrbitCheck API to create dashboard session
        const response = await createShopifyDashboardSession({
            client: orbitcheckClient,
            headers: {
                'Authorization': `Bearer ${sessionToken}`,
            },
        });

        if (response.error) {
            console.error('Dashboard session creation failed:', response.error);
            return new Response(
                JSON.stringify({ error: response.error }),
                { status: response.response?.status || 500, headers: { "Content-Type": "application/json" } }
            );
        }

        // Return the dashboard URL and session info
        return new Response(
            JSON.stringify(response.data),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error('Failed to create dashboard session:', error);
        return new Response(
            JSON.stringify({ error: 'Failed to create dashboard session' }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
};