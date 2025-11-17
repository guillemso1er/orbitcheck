import { shopifyAppUninstalledWebhook } from "@orbitcheck/contracts";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrbitcheckClient } from "../utils/orbitcheck.server.js";

const orbitcheckClient = getOrbitcheckClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, payload, apiVersion, webhookId } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Don't compute HMAC - let the API skip verification for internal calls
    // Or use a shared internal secret
    await shopifyAppUninstalledWebhook<true>({
      client: orbitcheckClient,
      body: payload ?? {},
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": typeof topic === "string" ? topic : String(topic),
        "X-Shopify-Shop-Domain": shop,
        "X-Shopify-Api-Version": apiVersion ?? "",
        "X-Shopify-Webhook-Id": webhookId ?? "",
        // Add internal auth header to bypass HMAC verification
        "X-Internal-Request": "shopify-app",
      },
      throwOnError: true,
    });
  } catch (error) {
    console.error("Failed to forward app/uninstalled webhook to OrbitCheck API", error);
  }

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
