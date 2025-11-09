import type { Redis as IORedisType } from "ioredis";
import { Pool } from "pg";
import { RouteHandlers } from "../generated/fastify/fastify.gen.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/api-keys.js";
import { loginUser, logoutUser, registerUser } from "../services/auth.js";
import { batchDeduplicateData, batchValidateData } from "../services/batch.js";
import { createStripeCheckoutSession, createStripeCustomerPortalSession } from "../services/billing.js";
import { deleteLogEntry, eraseUserData, getEventLogs, getUsageStatistics } from "../services/data.js";
import { dedupeAddress, dedupeCustomer, mergeDeduplicatedRecords } from "../services/dedupe.js";
import { getJobStatus } from "../services/jobs.js";
import { normalizeAddressCheap } from "../services/normalize.js";
import { evaluateOrderForRiskAndRules } from "../services/orders.js";
import { PlansService } from "../services/plans.js";
import { createProject, deleteProject, getUserProjects } from "../services/projects.js";
import { deleteCustomRule, getAvailableRules, getErrorCodeCatalog, getReasonCodeCatalog, registerCustomRules, testRulesAgainstPayload } from "../services/rules.js";
import { getTenantSettings, updateTenantSettings } from "../services/settings.js";
import { validateAddress, validateEmailAddress, validateName, validatePhoneNumber, validateTaxId, verifyPhoneOtp } from "../services/validation.js";
import { createWebhook, deleteWebhook, listWebhooks, testWebhook } from "../services/webhook.js";

export const serviceHandlers = (pool: Pool, redis: IORedisType): RouteHandlers => ({
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
    getAvailableRules: async (request, reply) => getAvailableRules(request, reply),
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
    evaluateOrder: async (request, reply) => evaluateOrderForRiskAndRules(request, reply, pool, redis),
    verifyPhoneOtp: async (request, reply) => verifyPhoneOtp(request, reply, pool),

    // Data handlers
    getLogs: async (request, reply) => getEventLogs(request, reply, pool),
    getUsage: async (request, reply) => getUsageStatistics(request, reply, pool),
    deleteLog: async (request, reply) => deleteLogEntry(request, reply, pool),
    eraseData: async (request, reply) => eraseUserData(request, reply, pool),

    // Personal Access Token handlers (placeholder implementations)
    listPersonalAccessTokens: async (request, reply) => {
        return reply.status(501).send({ error: { code: 'not_implemented', message: 'List PATs not implemented' } });
    },
    createPersonalAccessToken: async (request, reply) => {
        return reply.status(501).send({ error: { code: 'not_implemented', message: 'Create PAT not implemented' } });
    },
    revokePersonalAccessToken: async (request, reply) => {
        return reply.status(501).send({ error: { code: 'not_implemented', message: 'Revoke PAT not implemented' } });
    },

    // Settings handlers
    getSettings: async (request, reply) => getTenantSettings(request, reply, pool),
    updateSettings: async (request, reply) => updateTenantSettings(request, reply, pool),

    // Billing handlers
    createCheckoutSession: async (request, reply) => createStripeCheckoutSession(request, reply, pool),
    createCustomerPortalSession: async (request, reply) => createStripeCustomerPortalSession(request, reply, pool),

    // User management handlers (placeholder implementations)
    listUsers: async (request, reply) => {
        return reply.status(501).send({ error: { code: 'not_implemented', message: 'List users not implemented' } });
    },
    createUser: async (request, reply) => {
        return reply.status(501).send({ error: { code: 'not_implemented', message: 'Create user not implemented' } });
    },

    // Normalization handlers
    normalizeAddress: async (request, reply) => normalizeAddressCheap(request, reply),

    // Dedupe handlers
    dedupeCustomer: async (request, reply) => dedupeCustomer(request, reply, pool),
    dedupeAddress: async (request, reply) => dedupeAddress(request, reply, pool),
    mergeDeduplicated: async (request, reply) => mergeDeduplicatedRecords(request, reply, pool),

    // Batch handlers
    batchValidate: async (request, reply) => batchValidateData(request, reply, pool, redis),
    batchDedupe: async (request, reply) => batchDeduplicateData(request, reply, pool, redis),

    // Job handlers
    getJobStatusById: async (request, reply) => getJobStatus(request, reply, pool),

    // Project handlers
    getUserProjects: async (request, reply) => getUserProjects(request, reply, pool),
    createProject: async (request, reply) => createProject(request, reply, pool),
    deleteProject: async (request, reply) => deleteProject(request, reply, pool),

    // Plan handlers
    getUserPlan: async (request, reply) => {
        const plansService = new PlansService(pool);
        return plansService.getUserPlan((request as any).user_id);
    },
    updateUserPlan: async (request, reply) => {
        const plansService = new PlansService(pool);
        const { plan_slug, trial_days } = request.body as any;
        return plansService.updateUserPlan((request as any).user_id, plan_slug, trial_days);
    },
    getAvailablePlans: async (request, reply) => {
        const plansService = new PlansService(pool);
        return plansService.getPlanBySlug('free'); // This would need to be updated to get all plans
    },
    checkValidationLimits: async (request, reply) => {
        const plansService = new PlansService(pool);
        const { count = 1 } = request.body as any;
        return plansService.checkValidationLimit((request as any).user_id, count);
    }
})
