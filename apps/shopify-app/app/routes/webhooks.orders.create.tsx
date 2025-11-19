import { shopifyOrdersCreateWebhook } from "@orbitcheck/contracts";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrbitcheckClient } from "../utils/orbitcheck.server.js";

const orbitcheckClient = getOrbitcheckClient();

export const action = async ({ request }: ActionFunctionArgs) => {
    console.log("Incoming webhook request", {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries())
    });

    const { shop, topic, payload, apiVersion, webhookId } = await authenticate.webhook(request);

    console.log(`Received ${topic} webhook for ${shop}`);

    try {
        await shopifyOrdersCreateWebhook<true>({
            client: orbitcheckClient,
            body: payload ?? {},
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Topic": typeof topic === "string" ? topic : String(topic),
                "X-Shopify-Shop-Domain": shop,
                "X-Shopify-Api-Version": apiVersion ?? "",
                "X-Shopify-Webhook-Id": webhookId ?? "",
                "X-Internal-Request": "shopify-app",
            },
            throwOnError: true,
        });
    } catch (error) {
        console.error("Failed to forward orders/create webhook to OrbitCheck API", error);
    }

    return new Response();
};
