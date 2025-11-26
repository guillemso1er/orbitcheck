import * as crypto from 'node:crypto';

import type { FastifyInstance, RawServerBase } from "fastify";
import type { Redis as IORedisType } from "ioredis";
import type { Pool } from "pg";

import type { RouteHandlers } from "../generated/fastify/fastify.gen.js";
import { confirmAddressFixSession, getAddressFixSession } from "../integrations/shopify/address-fix/shopify-address-fix.js";
import { getAccessScopes } from "../integrations/shopify/api/access-scopes.js";
import { getShopSettings, updateShopSettings } from "../integrations/shopify/api/shop-settings.js";
import { callback } from "../integrations/shopify/auth/callback.js";
import { install } from "../integrations/shopify/auth/install.js";
import { appInstalled } from "../integrations/shopify/events/app-installed.js";
import { createDashboardSession } from "../integrations/shopify/events/dashboard-session.js";
import { appUninstalled } from "../integrations/shopify/webhooks/app-uninstalled.js";
import { customersCreate, customersUpdate } from "../integrations/shopify/webhooks/customers.js";
import { customersDataRequest, customersRedact, shopRedact } from "../integrations/shopify/webhooks/gdpr.js";
import { ordersCreate } from "../integrations/shopify/webhooks/orders-create.js";
import { shopifySSOHandler } from "../routes/shopify-sso.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/api-keys.js";
import { loginUser, logoutUser, registerUser } from "../services/auth.js";
import { batchDeduplicateData, batchEvaluateOrders, batchValidateData } from "../services/batch.js";
import { createStripeCheckoutSession, createStripeCustomerPortalSession } from "../services/billing.js";
import { deleteLogEntry, eraseUserData, getEventLogs, getUsageStatistics } from "../services/data.js";
import { dedupeAddress, dedupeCustomer, mergeDeduplicatedRecords } from "../services/dedupe/dedupe.js";
import { getJobStatus } from "../services/jobs.js";
import { normalizeAddressCheap } from "../services/normalize.js";
import { evaluateOrderForRiskAndRules } from "../services/orders.js";
import { createPersonalAccessToken, listPersonalAccessTokens, revokePersonalAccessToken } from "../services/pats.js";
import { createProject, deleteProject, getUserProjects } from "../services/projects.js";
import { computeRoiEstimate } from "../services/roi.js";
import { deleteCustomRule, getAvailableRules, getBuiltInRules, getErrorCodeCatalog, getReasonCodeCatalog, registerCustomRules, testRulesAgainstPayload } from "../services/rules/rules.js";
import { getTenantSettings, updateTenantSettings } from "../services/settings.js";
import { validateAddress, validateEmailAddress, validateName, validatePhoneNumber, validateTaxId, verifyPhoneOtp } from "../services/validation.js";
import { createWebhook, deleteWebhook, listWebhooks, testWebhook } from "../services/webhook.js";

const makeAuthHandlers = <TServer extends RawServerBase = RawServerBase>(pool: Pool, _redis: IORedisType, _app: FastifyInstance<TServer>): Partial<RouteHandlers> => ({
    loginUser: async (request, reply) => loginUser(request, reply, pool),
    registerUser: async (request, reply) => registerUser(request, reply, pool),
    logoutUser: async (request, reply) => logoutUser(request, reply, pool),
});

const makeApiKeyHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    listApiKeys: async (request, reply) => listApiKeys(request, reply, pool),
    createApiKey: async (request, reply) => createApiKey(request, reply, pool),
    revokeApiKey: async (request, reply) => revokeApiKey(request, reply, pool),
});

const makeWebhookHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    listWebhooks: async (request, reply) => listWebhooks(request, reply, pool),
    createWebhook: async (request, reply) => createWebhook(request, reply, pool),
    deleteWebhook: async (request, reply) => deleteWebhook(request, reply, pool),
    testWebhook: async (request, reply) => testWebhook(request, reply, pool),
});

const makeRulesHandlers = (pool: Pool, redis: IORedisType): Partial<RouteHandlers> => ({
    getAvailableRules: async (request, reply) => getAvailableRules(request, reply, pool),
    getBuiltInRules: async (request, reply) => getBuiltInRules(request, reply),
    getErrorCodeCatalog: async (request, reply) => getErrorCodeCatalog(request, reply),
    getReasonCodeCatalog: async (request, reply) => getReasonCodeCatalog(request, reply),
    testRulesAgainstPayload: async (request, reply) => testRulesAgainstPayload(request, reply, pool, redis),
    registerCustomRules: async (request, reply) => registerCustomRules(request, reply, pool),
    deleteCustomRule: async (request, reply) => deleteCustomRule(request, reply, pool),
});

const makeValidationHandlers = <TServer extends RawServerBase = RawServerBase>(pool: Pool, redis: IORedisType, app: FastifyInstance<TServer>): Partial<RouteHandlers> => ({
    validateEmail: async (request, reply) => validateEmailAddress(request, reply, pool, redis),
    validatePhone: async (request, reply) => validatePhoneNumber(request, reply, pool, redis),
    validateAddress: async (request, reply) => validateAddress(request, reply, pool, redis),
    validateTaxId: async (request, reply) => validateTaxId(request, reply, pool, redis),
    validateName: async (request, reply) => validateName(request, reply),
    evaluateOrder: async (request, reply) => evaluateOrderForRiskAndRules(app, request, reply, pool, redis),
    verifyPhoneOtp: async (request, reply) => verifyPhoneOtp(request, reply, pool),
});

const makeDataHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    getLogs: async (request, reply) => getEventLogs(request, reply, pool),
    getUsage: async (request, reply) => getUsageStatistics(request, reply, pool),
    deleteLog: async (request, reply) => deleteLogEntry(request, reply, pool),
    eraseData: async (request, reply) => eraseUserData(request, reply, pool),
});

const makePersonalAccessTokenHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    listPersonalAccessTokens: async (request, reply) => listPersonalAccessTokens(request, reply, pool),
    createPersonalAccessToken: async (request, reply) => createPersonalAccessToken(request, reply, pool),
    revokePersonalAccessToken: async (request, reply) => revokePersonalAccessToken(request, reply, pool),
});

const makeSettingsHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    getSettings: async (request, reply) => getTenantSettings(request, reply, pool),
    updateSettings: async (request, reply) => updateTenantSettings(request, reply, pool),
});

const makeBillingHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    createCheckoutSession: async (request, reply) => createStripeCheckoutSession(request, reply, pool),
    createCustomerPortalSession: async (request, reply) => createStripeCustomerPortalSession(request, reply, pool),
});

const makeUserHandlers = (): Partial<RouteHandlers> => ({
    listUsers: async (_request, reply) => {
        return reply.status(200).send({ data: [], request_id: crypto.randomUUID?.() });
    },
    createUser: async (_request, reply) => {
        return reply.status(400).send({ error: { code: 'INVALID_INPUT', message: 'Create user not implemented' }, request_id: crypto.randomUUID?.() });
    },
    normalizeAddress: async (request, reply) => normalizeAddressCheap(request, reply),
});

const makeDedupeHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    dedupeCustomer: async (request, reply) => dedupeCustomer(request, reply, pool),
    dedupeAddress: async (request, reply) => dedupeAddress(request, reply, pool),
    mergeDeduplicated: async (request, reply) => mergeDeduplicatedRecords(request, reply, pool),
});

const makeBatchHandlers = (pool: Pool, redis: IORedisType): Partial<RouteHandlers> => ({
    batchValidate: async (request, reply) => batchValidateData(request, reply, pool, redis),
    batchDedupe: async (request, reply) => batchDeduplicateData(request, reply, pool, redis),
    batchEvaluateOrders: async (request, reply) => batchEvaluateOrders(request, reply, pool, redis),
});

const makeJobHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    getJobStatusById: async (request, reply) => getJobStatus(request, reply, pool),
});

const makeRoiHandlers = (): Partial<RouteHandlers> => ({
    estimateRoi: async (request, reply) => computeRoiEstimate(request, reply),
});

const makeProjectHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    getUserProjects: async (request, reply) => getUserProjects(request, reply, pool),
    createProject: async (request, reply) => createProject(request, reply, pool),
    deleteProject: async (request, reply) => deleteProject(request, reply, pool),
});

const makePlanHandlers = (pool: Pool): Partial<RouteHandlers> => ({
    getUserPlan: async (request, reply) => {
        const { getUserPlanHandler } = await import('../services/plans.js');
        return getUserPlanHandler(request, reply, pool);
    },
    updateUserPlan: async (request, reply) => {
        const { updateUserPlanHandler } = await import('../services/plans.js');
        return updateUserPlanHandler(request, reply, pool);
    },
    getAvailablePlans: async (request, reply) => {
        const { getAvailablePlansHandler } = await import('../services/plans.js');
        return getAvailablePlansHandler(request, reply, pool);
    },
    checkValidationLimits: async (request, reply) => {
        const { checkValidationLimitsHandler } = await import('../services/plans.js');
        return checkValidationLimitsHandler(request, reply, pool);
    },
});

const makeShopifyHandlers = (pool: Pool, redis: IORedisType): Partial<RouteHandlers> => ({
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyInstall: async (request, reply) => install(request, reply),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyCallback: async (request, reply) => callback(request, reply, pool),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifySso: async (request, reply) => shopifySSOHandler(request, reply, pool, redis),

    // eslint-disable-next-line promise/prefer-await-to-callbacks
    getShopifyShopSettings: async (request, reply) => getShopSettings(request, reply, pool),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    updateShopifyShopSettings: async (request, reply) => updateShopSettings(request, reply, pool),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    getShopifyAccessScopes: async (request, reply) => getAccessScopes(request, reply, pool),

    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyAppInstalledEvent: async (request, reply) => appInstalled(request, reply, pool),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    createShopifyDashboardSession: async (request, reply) => createDashboardSession(request, reply, pool, redis),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyOrdersCreateWebhook: async (request, reply) => ordersCreate(request, reply, pool, redis),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyCustomersCreateWebhook: async (request, reply) => customersCreate(request, reply),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyCustomersUpdateWebhook: async (request, reply) => customersUpdate(request, reply),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyAppUninstalledWebhook: async (request, reply) => appUninstalled(request, reply, pool),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyGdprCustomersDataRequestWebhook: async (request, reply) => customersDataRequest(request, reply),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyGdprCustomersRedactWebhook: async (request, reply) => customersRedact(request, reply),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyGdprShopRedactWebhook: async (request, reply) => shopRedact(request, reply),

    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyAddressFixGet: async (request, reply) => getAddressFixSession(request, reply, pool),
    // eslint-disable-next-line promise/prefer-await-to-callbacks
    shopifyAddressFixConfirm: async (request, reply) => confirmAddressFixSession(request, reply, pool),
});

export const serviceHandlers = <TServer extends RawServerBase = RawServerBase>(pool: Pool, redis: IORedisType, app: FastifyInstance<TServer>): RouteHandlers => {
    const handlers = {
        ...makeAuthHandlers(pool, redis, app),
        ...makeApiKeyHandlers(pool),
        ...makeWebhookHandlers(pool),
        ...makeRulesHandlers(pool, redis),
        ...makeValidationHandlers(pool, redis, app),
        ...makeDataHandlers(pool),
        ...makePersonalAccessTokenHandlers(pool),
        ...makeSettingsHandlers(pool),
        ...makeBillingHandlers(pool),
        ...makeUserHandlers(),
        ...makeDedupeHandlers(pool),
        ...makeBatchHandlers(pool, redis),
        ...makeJobHandlers(pool),
        ...makeRoiHandlers(),
        ...makeProjectHandlers(pool),
        ...makePlanHandlers(pool),
        ...makeShopifyHandlers(pool, redis),
    };

    // cast to RouteHandlers since we've composed all required handlers above
    return handlers as RouteHandlers;
};
