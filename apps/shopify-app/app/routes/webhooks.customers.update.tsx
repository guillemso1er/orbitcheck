import { shopifyCustomersUpdateWebhook } from "@orbitcheck/contracts";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import type { Customer } from "../types/admin.types";
import { handleGraphQLResponse } from "../utils/graphql-error-handler";
import { getOrbitcheckClient } from "../utils/orbitcheck.server.js";
import { mapCustomerGraphQLToContract } from "../utils/webhook-mapper";

const orbitcheckClient = getOrbitcheckClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("Incoming webhook request", {
    method: request.method,
    url: request.url,
  });

  const { shop, topic, payload, apiVersion, webhookId, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic !== "CUSTOMERS_UPDATE") {
    console.warn(`Received unexpected topic: ${topic}`);
    return new Response();
  }

  if (!admin) {
    console.error("No admin context available for webhook");
    return new Response();
  }

  try {
    // 1. Extract ID and fetch fresh data
    const payloadId = (payload as any).id;
    const resourceId = `gid://shopify/Customer/${payloadId}`;

    const response = await admin.graphql(
      `#graphql
            query getCustomer($id: ID!) {
              customer(id: $id) {
                id
                createdAt
                updatedAt
                firstName
                lastName
                state
                note
                verifiedEmail
                tags
                numberOfOrders
                amountSpent { amount currencyCode }
                defaultEmailAddress {
                  emailAddress
                  marketingState
                  marketingOptInLevel
                  marketingUpdatedAt
                }
                defaultPhoneNumber {
                  phoneNumber
                  marketingState
                  marketingOptInLevel
                  marketingUpdatedAt
                  marketingCollectedFrom
                }
                defaultAddress {
                  firstName lastName address1 address2 city province provinceCode zip country countryCodeV2 company phone latitude longitude name
                }
                addresses {
                  firstName lastName address1 address2 city province provinceCode zip country countryCodeV2 company phone latitude longitude name
                }
              }
            }`,
      { variables: { id: resourceId } }
    );

    const jsonResponse = await response.json();

    // Handle GraphQL errors including PII access denied
    const { data, errorResult } = handleGraphQLResponse(jsonResponse, shop, topic);

    // If there are non-PII errors, log them but continue processing
    // PII access denied is expected in some cases and data will have null fields
    if (errorResult.otherErrors.length > 0) {
      console.warn(`[${topic}] GraphQL returned errors for ${shop}`, {
        errors: errorResult.otherErrors,
      });
    }

    if (!data?.customer) {
      console.error("Failed to fetch customer data from Shopify GraphQL", {
        shop,
        resourceId,
        hasPiiAccessDenied: errorResult.hasPiiAccessDenied,
        deniedFields: errorResult.deniedPiiFields,
      });
      return new Response();
    }

    // 2. Map to contract type
    const customerBody = mapCustomerGraphQLToContract(data.customer as Customer);

    // 3. Send to OrbitCheck API
    await shopifyCustomersUpdateWebhook<true>({
      client: orbitcheckClient,
      body: customerBody,
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
    const msg = (error as Error).message;
    if (msg === 'fetch failed' || msg.includes('ECONNREFUSED')) {
      console.warn("Failed to forward customers/update webhook to OrbitCheck API: API appears to be down.");
    } else {
      console.error("Failed to forward customers/update webhook to OrbitCheck API", error);
    }
  }

  return new Response();
};
