Here’s a Shopify-docs–only checklist (with links) to implement your non‑Remix React app + separate Fastify API with the scopes, GDPR webhooks, uninstall cleanup, and dev‑store install. Where Shopify docs don’t cover a piece (for example, PostHog), I’ll flag it so you can decide if you want me to pull those external docs next.

High‑level architecture (official guidance)
- Frontend: Embedded React app using App Bridge (v4) and, if you want a maintained starter, Shopify’s React Router app package. These give you App Bridge + session token auth patterns without Remix. 
- Backend: Node library @shopify/shopify-api is framework‑agnostic; you can use it inside Fastify for OAuth/token exchange, Admin API calls, and webhook helpers. 

1) Configure scopes: read/write orders and customers
- What to request: read_orders and write_orders; read_customers and write_customers. If you need orders beyond the last 60 days, also request read_all_orders (requires additional approval). 
- Where to set them: in your app’s shopify.app.toml (Shopify‑managed install). Example:
  [access_scopes]
  scopes = "read_orders,write_orders,read_customers,write_customers"
  # Add read_all_orders only after approval
- Shopify’s scope docs and TOML config flow. 

2) Auth between React and Fastify (embedded apps)
- Session tokens: All embedded apps must use session tokens for frontend→backend requests. App Bridge v4 adds an Authorization: Bearer <JWT> header automatically; your backend must verify this token. 
- How to verify a session token (JWT HS256) on the server (Fastify): follow the verification steps (HS256 with your app secret). 
- If you need manual OAuth (non‑managed install or external tool): follow the Authorization Code Grant (build authorize URL, handle state, exchange code for token; per‑user = online token; omit for offline). 

3) React setup (non‑Remix)
- App Bridge v4: load the script and use the React hooks library.
  - Add to your index.html head:
    <meta name="shopify-api-key" content="YOUR_API_KEY" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  - In React, use @shopify/app-bridge-react v4 hooks (e.g., useAppBridge) and fetch via window.fetch (App Bridge injects session token). 
- If you want a maintained non‑Remix starter: use @shopify/shopify-app-react-router. It ships the same authentication patterns and webhook helpers you can wire to Fastify. 
- Polaris UI (optional, for admin-embedded UI). 

4) Register GDPR webhooks and uninstall cleanup
- Mandatory GDPR webhooks you must implement:
  - customers/data_request
  - customers/redact
  - shop/redact
  These must be active and HMAC‑verified before app review. 
- Recommended: configure these as “app‑specific” compliance webhooks in shopify.app.toml:
  [webhooks]
  api_version = "2025-10"
  [[webhooks.subscriptions]]
  uri = "/webhooks"
  topics = ["app/uninstalled"]  # for cleanup
  compliance_topics = ["customers/data_request","customers/redact","shop/redact"]
  Then deploy: shopify app deploy. 
- Payload shapes and behavior (what to delete/return): see the GDPR guide for payload fields and timing (for example, shop/redact 48 hours after uninstall; customers/redact may be delayed up to 6 months based on orders). 
- Uninstall cleanup: subscribe to app/uninstalled and purge your shop sessions/records. Example cleanup logic is shown in the webhooks guide. 

5) Webhook delivery + HMAC verification (Fastify)
- Shopify signs each webhook with X-Shopify-Hmac-Sha256. You must compute the HMAC on the raw body with your app secret and compare in timing‑safe fashion. Invalid signature must return 401; valid should return 200 quickly. 
- Minimal Fastify pattern (adapted from the official algorithm):
  - Use raw body for HMAC (Fastify: set config to keep rawBody via a contentTypeParser or plugin).
  - Compare crypto.createHmac('sha256', secret).update(rawBody).digest('base64') with header.
  - Respond 200 on success; 401 on failure, and do long work async.
  (Algorithm and header naming per docs.) 

6) Putting it together in Fastify (key endpoints)
- GET /auth?shop={shop}: If you need manual OAuth, redirect to /admin/oauth/authorize as per authorization code grant. Otherwise, with Shopify‑managed install, this step is handled by Shopify after you deploy your TOML config. 
- GET /auth/callback: Verify state, exchange code for token, store offline/online tokens. 
- POST /webhooks: Verify HMAC; route by topic for:
  - customers/data_request: locate and return or prepare customer data as required.
  - customers/redact: delete customer PII for that shop.
  - shop/redact: delete all customer PII for that shop.
  - app/uninstalled: delete sessions/tokens for that shop. 
- Admin API calls: use @shopify/shopify-api with the stored access token to read/write orders and customers. Library is framework‑agnostic and supports any Node backend including Fastify. 

7) Install and test on a development (test) store
- Create/select a dev store from your Partner/Dev Dashboard and install your app:
  - From the app page, Test your app → Select store → Install app (you’ll see the OAuth consent). 
- With Shopify CLI scaffolds, you can also press p during dev to open the preview and trigger install onto your dev store. 
- Dev store requirements/limits are documented here (use these for realistic testing). 

8) Useful details you’ll likely need
- Orders access window: by default 60 days; to read older orders, add read_all_orders (requires approval) besides read_orders/write_orders. 
- Checking current scopes on a shop: Admin REST GET /admin/oauth/access_scopes.json can show granted scopes for your token. 

Example snippets you can adapt

A) shopify.app.toml (managed install + scopes + GDPR + uninstall)
[access_scopes]
scopes = "read_orders,write_orders,read_customers,write_customers"
# read_all_orders only after it’s approved in the dashboard

[webhooks]
api_version = "2025-10"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks"

[[webhooks.subscriptions]]
compliance_topics = ["customers/data_request","customers/redact","shop/redact"]
uri = "/webhooks"


B) React (App Bridge v4)
- index.html: add meta shopify-api-key + app-bridge.js script.
- Use useAppBridge hook inside your components; fetch to your Fastify API will carry the Authorization header with a short‑lived session token. 

C) Fastify: webhook verification outline
- Read raw body.
- Validate X-Shopify-Hmac-Sha256.
- 200 on success, 401 on failure.
- Switch by X-Shopify-Topic → handle GDPR and app/uninstalled. 

D) OAuth (if you aren’t using Shopify‑managed install)
- Build authorize URL with scopes, redirect_uri, state, and optional grant_options[]=per-user for online tokens; then exchange code for token on callback. 

About logs + PostHog
- Shopify docs don’t prescribe a logging stack or PostHog instrumentation. If you want, I can pull PostHog’s official docs next and give you small, copy‑paste snippets for:
  - Emitting server logs (pino) and forwarding key events.
  - PostHog identify/capture for: signup (after first successful install), first validation, correction, block.
- Let me know and I’ll fetch the PostHog docs and wire them into the above flow.

Awesome — here’s a production‑ready Fastify server you can drop into your stack. It uses @shopify/shopify-api for session token auth + token exchange, validates webhook HMACs (GDPR + uninstall), and emits PostHog events for signup, first validation, correction, and block. I also added the exact Shopify doc pointers for each moving part.

What you’ll set first
- In shopify.app.toml
  - Scopes: read_orders, write_orders, read_customers, write_customers. (Optionally read_all_orders after it’s approved.) 
  - Webhooks: app/uninstalled as a normal webhook; add the three mandatory GDPR compliance topics. 
- Managed install on your dev store is handled by Shopify once TOML is configured; you’ll install to the test store via the CLI/Dev Dashboard. 

.env you’ll need
- SHOPIFY_API_KEY=...
- SHOPIFY_API_SECRET=...
- APP_URL=https://your-domain.tld
- POSTHOG_KEY=phc_...
- POSTHOG_HOST=https://us.i.posthog.com  (default US cloud; change if you use EU cloud) 

server.ts (or server.mjs) — Fastify + Shopify + PostHog
```ts
import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import crypto from 'crypto';
import { PostHog } from 'posthog-node';
import {
  shopifyApi,
  LATEST_API_VERSION,
  RequestedTokenType,
} from '@shopify/shopify-api';

const {
  SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET,
  APP_URL,
  POSTHOG_KEY,
  POSTHOG_HOST = 'https://us.i.posthog.com',
  NODE_ENV,
  PORT = 3000,
} = process.env;

// 1) Initialize Shopify API (framework-agnostic)
const shopify = shopifyApi({
  apiKey: SHOPIFY_API_KEY!,
  apiSecretKey: SHOPIFY_API_SECRET!,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  // hostName should be the hostname (no protocol)
  hostName: new URL(APP_URL!).host,
});

// 2) PostHog (server-side analytics)
const posthog = new PostHog(POSTHOG_KEY!, { host: POSTHOG_HOST });

// 3) Fastify with logs enabled
const app = Fastify({ logger: true });

// Raw body only where needed (webhooks)
await app.register(rawBody, {
  field: 'rawBody',
  global: false,
  runFirst: true,
});

// Utility: verify Shopify webhook HMAC on the raw body
function verifyWebhookHmac(rawBody: Buffer | string, hmacHeader?: string) {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET!)
    .update(rawBody)
    .digest('base64');
  // timing safe compare
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(hmacHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Middleware-ish: verify session token on embedded requests
async function requireSessionToken(req: any, reply: any) {
  // App Bridge adds Authorization: Bearer <JWT>
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    reply.code(401).header('X-Shopify-Retry-Invalid-Session-Request', '1').send();
    return;
  }

  try {
    // Verify the JWT signature + claims using Shopify’s library
    // Returns payload with dest, iss, aud, sub, exp, etc.
    // https://shopify.dev/.../set-embedded-app-authorization (decodeSessionToken example)
    const decoded = await shopify.session.decodeSessionToken(token);
    const dest = new URL(decoded.dest);
    req.shopDomain = dest.hostname; // e.g., mystore.myshopify.com
    req.sessionToken = token;
  } catch (err) {
    // Ask App Bridge to refresh and retry once
    reply.code(401).header('X-Shopify-Retry-Invalid-Session-Request', '1').send();
  }
}

// Example: complete install after first embedded hit (get offline token once)
app.post('/api/install/complete', { preHandler: requireSessionToken }, async (req, reply) => {
  const shop = req.shopDomain as string;

  // Exchange the short-lived session token for an offline access token we can store
  // https://shopify.dev/.../set-embedded-app-authorization (auth.tokenExchange example)
  const offline = await shopify.auth.tokenExchange({
    shop,
    sessionToken: req.sessionToken,
    requestedTokenType: RequestedTokenType.OfflineAccessToken,
  });

  // TODO: persist offline.accessToken keyed by shop in your DB
  await persistOfflineToken(shop, offline.accessToken);

  // Emit “signup” event in PostHog when we first store an offline token
  posthog.capture({
    distinctId: shop,
    event: 'signup',
    properties: { shop, source: 'app_install' },
  });

  reply.send({ ok: true });
});

// Example protected route: get an online token for per-user actions and call Admin GraphQL
app.get('/api/admin/shop-name', { preHandler: requireSessionToken }, async (req, reply) => {
  const shop = req.shopDomain as string;

  // Exchange session token -> online access token for Admin calls
  const online = await shopify.auth.tokenExchange({
    shop,
    sessionToken: req.sessionToken,
    requestedTokenType: RequestedTokenType.OnlineAccessToken,
  });

  // Make a simple GraphQL Admin API call (returns shop name)
  // Official Node usage: new shopify.clients.Graphql({ session }) then client.query(...)
  // https://shopify.dev/docs/api/admin-graphql/latest (Node example)
  const session = {
    shop,
    accessToken: online.accessToken,
    // library accepts plain object with shop + accessToken
  } as any;

  const client = new shopify.clients.Graphql({ session });
  const result = await client.query({
    data: `query { shop { name } }`,
  });

  reply.send(result.body);
});

// Event examples you can call from your domain logic
app.post('/api/validate', { preHandler: requireSessionToken }, async (req, reply) => {
  const shop = req.shopDomain as string;
  posthog.capture({
    distinctId: shop,
    event: 'first_validation',
    properties: { shop },
  });
  reply.send({ ok: true });
});

app.post('/api/correction', { preHandler: requireSessionToken }, async (req, reply) => {
  const shop = req.shopDomain as string;
  posthog.capture({
    distinctId: shop,
    event: 'correction',
    properties: { shop },
  });
  reply.send({ ok: true });
});

app.post('/api/block', { preHandler: requireSessionToken }, async (req, reply) => {
  const shop = req.shopDomain as string;
  posthog.capture({
    distinctId: shop,
    event: 'block',
    properties: { shop },
  });
  reply.send({ ok: true });
});

// Webhooks endpoint (GDPR + uninstall). Make sure to send raw body.
app.route({
  method: 'POST',
  url: '/webhooks',
  config: { rawBody: true },
  handler: async (req: any, reply) => {
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string | undefined;
    const topic = (req.headers['x-shopify-topic'] as string | undefined) || '';
    const shop = (req.headers['x-shopify-shop-domain'] as string | undefined) || 'unknown';
    const raw = req.rawBody || Buffer.from('');

    if (!verifyWebhookHmac(raw, hmacHeader)) {
      req.log.warn({ topic, shop }, 'Invalid webhook HMAC');
      return reply.code(401).send('Invalid HMAC');
    }

    // Acknowledge quickly; do heavy work async
    reply.code(200).send('OK');

    // Route by topic
    try {
      const payload = JSON.parse(raw.toString('utf8'));

      switch (topic.toLowerCase()) {
        case 'app/uninstalled':
          // Clean up shop data/tokens
          await deleteShopData(shop);
          posthog.capture({ distinctId: shop, event: 'uninstalled', properties: { shop } });
          break;

        case 'customers/data_request':
          // Prepare customer data to provide to merchant if requested (out-of-band)
          // payload example documented in GDPR guide
          // No data returned in webhook response itself
          break;

        case 'customers/redact':
          // Delete PII related to the given customer for this shop
          break;

        case 'shop/redact':
          // 48 hours after uninstall, erase all customer data for this shop
          await eraseShopCustomerData(shop);
          break;

        default:
          // Handle other subscribed topics (orders/* etc.) if you add them
          break;
      }
    } catch (e) {
      app.log.error(e);
    }
  },
});

// Basic health check
app.get('/health', async () => ({ ok: true }));

// graceful shutdown (flush PostHog)
const close = async () => {
  try {
    await posthog.shutdown();
    await app.close();
    process.exit(0);
  } catch {
    process.exit(1);
  }
};
process.on('SIGTERM', close);
process.on('SIGINT', close);

app.listen({ port: Number(PORT), host: '0.0.0.0' }).then(() => {
  app.log.info(`API listening on ${PORT} (${NODE_ENV})`);
});

// ---- Replace with your real persistence ----
async function persistOfflineToken(shop: string, token: string) {
  // save {shop, token, createdAt} to your DB
}
async function deleteShopData(shop: string) {
  // remove tokens, sessions, app data for this shop
}
async function eraseShopCustomerData(shop: string) {
  // delete PII as per your data model
}
```

Why this matches Shopify’s current guidance
- Embedded app requests must use session tokens; your backend must decode/verify the token on every call. The library method session.decodeSessionToken handles verification for you, and on failure you return 401 with X‑Shopify‑Retry‑Invalid‑Session‑Request so App Bridge refreshes the token and retries. 
- After validating the session token, exchange it for an Admin API access token via the token exchange endpoint. The Node library provides auth.tokenExchange and supports requesting OnlineAccessToken or OfflineAccessToken. 
- Webhooks must be verified using the X‑Shopify‑Hmac‑SHA256 header computed over the raw request body with your app secret; respond quickly with 200. 
- Mandatory GDPR webhooks you must subscribe to: customers/data_request, customers/redact, shop/redact. app/uninstalled is recommended for cleanup. 
- Example Node GraphQL client usage is new shopify.clients.Graphql({session}) and client.query({data}). 

PostHog snippets (server-side)
- Install and initialize posthog-node; default US cloud host shown here. Use capture to log events. You can also identify or set properties with $set / $set_once when useful. 
- If you run in short‑lived contexts, call shutdown() before process exit; the code above flushes on SIGINT/SIGTERM. 

How to install on a test store (managed install)
- Ensure TOML includes your scopes and webhook subscriptions (including compliance topics), deploy config, then use the CLI to run your app and install to your dev store when prompted. Shopify manages the install dialog and scopes for you. 

Quick TOML example to match your requirements
```toml
# shopify.app.toml
client_id = "YOUR_API_KEY"
name = "My App"
application_url = "https://your-domain.tld"
embedded = true

[build]
include_config_on_deploy = true

[access_scopes]
scopes = "read_orders,write_orders,read_customers,write_customers" # add read_all_orders if approved

[auth]
redirect_urls = ["https://your-domain.tld/auth/callback"]

[webhooks]
api_version = "2025-07"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks"

[[webhooks.subscriptions]]
compliance_topics = ["customers/data_request","customers/redact","shop/redact"]
uri = "/webhooks"
```
(GDPR compliance topics and app/uninstalled are configured here; deploy with shopify app deploy.) 

Notes and gotchas
- If the session token decode fails (expired, scopes changed), return 401 with X‑Shopify‑Retry‑Invalid‑Session‑Request and App Bridge will refresh and retry once. 
- Keep webhook handlers fast; do any heavy work async and always respond 200, or Shopify will retry and may eventually delete the subscription after repeated non‑200s. 
- Orders older than 60 days require read_all_orders in addition to read_orders/write_orders and explicit approval in the Dev Dashboard. 

