import { FastifyInstance, RawServerBase } from "fastify";
import type { Redis as IORedisType } from "ioredis";
import * as crypto from 'node:crypto';
import { Pool } from "pg";
import { RouteHandlers } from "../generated/fastify/fastify.gen.js";
import { getAccessScopes } from "../integrations/shopify/api/access-scopes.js";
import { getShopSettings, updateShopSettings } from "../integrations/shopify/api/shop-settings.js";
import { callback } from "../integrations/shopify/auth/callback.js";
import { install } from "../integrations/shopify/auth/install.js";
import { appInstalled } from "../integrations/shopify/events/app-installed.js";
import { appUninstalled } from "../integrations/shopify/webhooks/app-uninstalled.js";
import { customersDataRequest, customersRedact, shopRedact } from "../integrations/shopify/webhooks/gdpr.js";
import { ordersCreate } from "../integrations/shopify/webhooks/orders-create.js";
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

export const serviceHandlers = <TServer extends RawServerBase = RawServerBase>(pool: Pool, redis: IORedisType, app: FastifyInstance<TServer>): RouteHandlers => ({
    // Auth handlers
    loginUser: async (request, reply) => loginUser(request, reply, pool),
    registerUser: async (request, reply) => registerUser(request, reply, pool),
    logoutUser: async (request, reply) => logoutUser(request, reply),

    // API Key handlers
    listApiKeys: async (request, reply) => listApiKeys(request, reply, pool),
    createApiKey: async (request, reply) => createApiKey(request, reply, pool),
    revokeApiKey: async (request, reply) => revokeApiKey(request, reply, pool),

    // Webhook handlers
    listWebhooks: async (request, reply) => listWebhooks(request, reply, pool),
    createWebhook: async (request, reply) => createWebhook(request, reply, pool),
    deleteWebhook: async (request, reply) => deleteWebhook(request, reply, pool),
    testWebhook: async (request, reply) => testWebhook(request, reply, pool),

    // Rules handlers
    getAvailableRules: async (request, reply) => getAvailableRules(request, reply, pool),
    getBuiltInRules: async (request, reply) => getBuiltInRules(request, reply),
    getErrorCodeCatalog: async (request, reply) => getErrorCodeCatalog(request, reply),
    getReasonCodeCatalog: async (request, reply) => getReasonCodeCatalog(request, reply),
    testRulesAgainstPayload: async (request, reply) => testRulesAgainstPayload(request, reply, pool, redis),
    registerCustomRules: async (request, reply) => registerCustomRules(request, reply, pool),
    deleteCustomRule: async (request, reply) => deleteCustomRule(request, reply, pool),

    // Validation handlers
    validateEmail: async (request, reply) => validateEmailAddress(request, reply, pool, redis),
    validatePhone: async (request, reply) => validatePhoneNumber(request, reply, pool, redis),
    validateAddress: async (request, reply) => validateAddress(request, reply, pool, redis),
    validateTaxId: async (request, reply) => validateTaxId(request, reply, pool, redis),
    validateName: async (request, reply) => validateName(request, reply),
    evaluateOrder: async (request, reply) => evaluateOrderForRiskAndRules(app, request, reply, pool, redis),
    verifyPhoneOtp: async (request, reply) => verifyPhoneOtp(request, reply, pool),

    // Data handlers
    getLogs: async (request, reply) => getEventLogs(request, reply, pool),
    getUsage: async (request, reply) => getUsageStatistics(request, reply, pool),
    deleteLog: async (request, reply) => deleteLogEntry(request, reply, pool),
    eraseData: async (request, reply) => eraseUserData(request, reply, pool),

    // Personal Access Token handlers
    listPersonalAccessTokens: async (request, reply) => listPersonalAccessTokens(request, reply, pool),
    createPersonalAccessToken: async (request, reply) => createPersonalAccessToken(request, reply, pool),
    revokePersonalAccessToken: async (request, reply) => revokePersonalAccessToken(request, reply, pool),

    // Settings handlers
    getSettings: async (request, reply) => getTenantSettings(request, reply, pool),
    updateSettings: async (request, reply) => updateTenantSettings(request, reply, pool),

    // Billing handlers
    createCheckoutSession: async (request, reply) => createStripeCheckoutSession(request, reply, pool),
    createCustomerPortalSession: async (request, reply) => createStripeCustomerPortalSession(request, reply, pool),

    // User management handlers (placeholder implementations)
    listUsers: async (_request, reply) => {
        // Placeholder implementation returning empty list
        return reply.status(200).send({ data: [], request_id: crypto.randomUUID?.() });
    },
    createUser: async (_request, reply) => {
        // Placeholder implementation returning error (bad request)
        return reply.status(400).send({ error: { code: 'INVALID_INPUT', message: 'Create user not implemented' }, request_id: crypto.randomUUID?.() });
    },
    normalizeAddress: async (request, reply) => normalizeAddressCheap(request, reply),

    // Dedupe handlers
    dedupeCustomer: async (request, reply) => dedupeCustomer(request, reply, pool),
    dedupeAddress: async (request, reply) => dedupeAddress(request, reply, pool),
    mergeDeduplicated: async (request, reply) => mergeDeduplicatedRecords(request, reply, pool),

    // Batch handlers
    batchValidate: async (request, reply) => batchValidateData(request, reply, pool, redis),
    batchDedupe: async (request, reply) => batchDeduplicateData(request, reply, pool, redis),
    batchEvaluateOrders: async (request, reply) => batchEvaluateOrders(request, reply, pool, redis),

    // Job handlers
    getJobStatusById: async (request, reply) => getJobStatus(request, reply, pool),

    // ROI handlers
    estimateRoi: async (request) => {
        const body = request.body as any;
        const { inputs, estimates } = computeRoiEstimate({
            orders_per_month: body.orders_per_month,
            issue_rate: body.issue_rate,
            carrier_fee_share: body.carrier_fee_share,
            avg_correction_fee: body.avg_correction_fee,
            reship_share: body.reship_share,
            reship_cost: body.reship_cost,
            prevention_rate: body.prevention_rate
        });

        return {
            inputs: {
                orders_per_month: inputs.orders_per_month,
                issue_rate: inputs.issue_rate,
                carrier_fee_share: inputs.carrier_fee_share,
                avg_correction_fee: inputs.avg_correction_fee,
                reship_share: inputs.reship_share,
                reship_cost: inputs.reship_cost,
                prevention_rate: inputs.prevention_rate,
                currency: body.currency ?? 'USD'
            },
            estimates: {
                issues_per_month: estimates.issues_per_month,
                loss_per_issue: Number(estimates.loss_per_issue.toFixed(2)),
                baseline_loss_per_month: Number(estimates.baseline_loss_per_month.toFixed(2)),
                savings_per_month: Number(estimates.savings_per_month.toFixed(2))
            },
            meta: {
                model_version: 'roi-v1',
                request_id: crypto.randomUUID?.() ?? 'unknown'
            }
        } as any;
    },

    // Project handlers
    getUserProjects: async (request, reply) => getUserProjects(request, reply, pool),
    createProject: async (request, reply) => createProject(request, reply, pool),
    deleteProject: async (request, reply) => deleteProject(request, reply, pool),

    // Plan handlers
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
    //shopify integration handlers will go here in the future
    shopifyInstall: async (request, reply) => install(request, reply),
    shopifyCallback: async (request, reply) => callback(request, reply, pool),

    getShopifyShopSettings: async (request, reply) => getShopSettings(request, reply, pool),
    updateShopifyShopSettings: async (request, reply) => updateShopSettings(request, reply, pool),
    getShopifyAccessScopes: async (request, reply) => getAccessScopes(request, reply, pool),

    shopifyAppInstalledEvent: async (request, reply) => appInstalled(request, reply, pool),
    shopifyOrdersCreateWebhook: async (request, reply) => ordersCreate(request, reply),
    shopifyAppUninstalledWebhook: async (request, reply) => appUninstalled(request, reply, pool),
    shopifyGdprCustomersDataRequestWebhook: async (request, reply) => customersDataRequest(request, reply),
    shopifyGdprCustomersRedactWebhook: async (request, reply) => customersRedact(request, reply),
    shopifyGdprShopRedactWebhook: async (request, reply) => shopRedact(request, reply),

})
