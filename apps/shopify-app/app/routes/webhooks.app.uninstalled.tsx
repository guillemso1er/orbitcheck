import { shopifyAppUninstalledWebhook } from "@orbitcheck/contracts";
import { createHmac } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { getOrbitcheckClient } from "../utils/orbitcheck.server.js";

const orbitcheckClient = getOrbitcheckClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const cloned = request.clone();
  const rawBody = await cloned.text();
  const { shop, session, topic, payload, apiVersion, webhookId } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const jsonBody = rawBody.length > 0 ? rawBody : JSON.stringify(payload ?? {});
  const secret = process.env.SHOPIFY_API_SECRET;

  if (!secret) {
    console.warn("SHOPIFY_API_SECRET is not set; forwarding uninstalled webhook without HMAC verification");
  }

  try {
    const hmac = secret
      ? createHmac("sha256", secret).update(jsonBody, "utf8").digest("base64")
      : undefined;

    await shopifyAppUninstalledWebhook<true>({
      client: orbitcheckClient,
      body: payload ?? {},
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Topic": typeof topic === "string" ? topic : String(topic),
        "X-Shopify-Shop-Domain": shop,
        ...(hmac ? { "X-Shopify-Hmac-Sha256": hmac } : {}),
        ...(apiVersion ? { "X-Shopify-Api-Version": apiVersion } : {}),
        ...(webhookId ? { "X-Shopify-Webhook-Id": webhookId } : {}),
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
