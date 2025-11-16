import { shopifyAppInstalledEvent } from "@orbitcheck/contracts";
import { createHmac } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";
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
        console.warn("SHOPIFY_API_SECRET is not set; forwarding installed webhook without HMAC verification");
    }

    const payloadObject = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : undefined;
    const payloadAccessToken =
        typeof payloadObject?.["accessToken"] === "string"
            ? (payloadObject["accessToken"] as string)
            : undefined;

    const parsedPayloadScopes = (() => {
        if (!payloadObject) {
            return undefined;
        }
        const rawGrantedScopes = payloadObject["grantedScopes"];
        if (Array.isArray(rawGrantedScopes) && rawGrantedScopes.every((scope) => typeof scope === "string")) {
            return rawGrantedScopes as string[];
        }
        const rawScope = payloadObject["scope"];
        if (typeof rawScope === "string") {
            return rawScope
                .split(",")
                .map((scope) => scope.trim())
                .filter(Boolean);
        }
        return undefined;
    })();

    const sessionScopes = session?.scope
        ? session.scope
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : undefined;

    const accessToken = session?.accessToken ?? payloadAccessToken;
    const grantedScopes = sessionScopes ?? parsedPayloadScopes ?? [];

    if (!accessToken) {
        console.warn("Unable to determine Shopify access token for installed webhook", { shop });
        return new Response(undefined, { status: 200 });
    }

    try {
        const hmac = secret
            ? createHmac("sha256", secret).update(jsonBody, "utf8").digest("base64")
            : undefined;

        await shopifyAppInstalledEvent<true>({
            client: orbitcheckClient,
            body: {
                shop,
                accessToken,
                grantedScopes,
            },
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
        console.error("Failed to forward app/installed webhook to OrbitCheck API", error);
    }

    // Webhook requests can trigger multiple times and after an app has already been installed.
    // If this webhook already ran, the session may have been created previously.
    if (session) {
        try {
            await sessionStorage.storeSession(session);
        } catch (error) {
            console.error("Failed to persist Shopify session for installed webhook", { shop, error });
        }
    } else {
        console.warn("No Shopify session available for installed webhook", { shop });
    }

    return new Response();
};
