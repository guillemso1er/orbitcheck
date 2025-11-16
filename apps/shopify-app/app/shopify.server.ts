import { shopifyAppInstalledEvent } from "@orbitcheck/contracts";
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { getOrbitcheckClient } from "./utils/orbitcheck.server.js";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  hooks: {
    afterAuth: async ({ session }) => {
      const client = getOrbitcheckClient();

      const scopeList = session.scope
        ? session.scope
          .split(",")
          .map((scope) => scope.trim().toLowerCase())
          .filter(Boolean)
        : [];

      if (!session.isOnline) {
        if (!session.accessToken) {
          console.warn("Shopify session missing access token during afterAuth hook", {
            shop: session.shop,
          });
          return;
        }
        try {
          await shopifyAppInstalledEvent<true>({
            client,
            body: {
              shop: session.shop,
              accessToken: session.accessToken,
              grantedScopes: scopeList,
            },
            throwOnError: true,
          });
        } catch (error) {
          console.error("Failed to notify OrbitCheck API about Shopify installation", error);
        }
      }

      try {
        await shopify.registerWebhooks({ session });
      } catch (error) {
        console.error("Failed to register Shopify webhooks", error);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate: typeof shopify.authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks: typeof shopify.registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
