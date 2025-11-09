import type { Redis as IORedisType } from "ioredis";
import crypto from 'node:crypto';
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
import { createPersonalAccessToken, listPersonalAccessTokens, revokePersonalAccessToken } from "../services/pats.js";
import { PlansService } from "../services/plans.js";
import { createProject, deleteProject, getUserProjects } from "../services/projects.js";
import { deleteCustomRule, getAvailableRules, getErrorCodeCatalog, getReasonCodeCatalog, registerCustomRules, testRulesAgainstPayload } from "../services/rules/rules.js";
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
        const userPlan = await plansService.getUserPlan((request as any).user_id);
        const response = {
            id: userPlan.id,
            email: userPlan.email,
            monthlyValidationsUsed: userPlan.monthlyValidationsUsed,
            subscriptionStatus: userPlan.subscriptionStatus,
            trialEndDate: userPlan.trialEndDate,
            projectsCount: userPlan.projectsCount,
            plan: { ...userPlan.plan }
        };
        return reply.status(200).send(response);
    },
    updateUserPlan: async (request, reply) => {
        const plansService = new PlansService(pool);
        const { planSlug, trialDays } = request.body as any; // Align with generated types
        if (!planSlug || typeof planSlug !== 'string') {
            return reply.status(400).send({ error: { code: 'INVALID_INPUT', message: 'planSlug is required' } });
        }
        const userPlan = await plansService.updateUserPlan((request as any).user_id, planSlug, trialDays);
        const response = {
            id: userPlan.id,
            email: userPlan.email,
            monthlyValidationsUsed: userPlan.monthlyValidationsUsed,
            subscriptionStatus: userPlan.subscriptionStatus,
            trialEndDate: userPlan.trialEndDate,
            projectsCount: userPlan.projectsCount,
            plan: { ...userPlan.plan }
        };
        return reply.status(200).send(response);
    },
    getAvailablePlans: async (_request, reply) => {
        const plansService = new PlansService(pool);
        // Temporary: return only the free plan as array, shape matching spec
        const free = await plansService.getPlanBySlug('free');
        const arr = free ? [{ id: free.id, name: free.name, slug: free.slug, price: free.price, validationsLimit: free.validationsLimit, projectsLimit: free.projectsLimit, features: free.features }] : [];
        return reply.status(200).send(arr);
    },
    checkValidationLimits: async (request, reply) => {
        const plansService = new PlansService(pool);
        const { count = 1 } = request.body as any;
        const usage = await plansService.checkValidationLimit((request as any).user_id, count);
        const response = {
            canProceed: usage.remainingValidations > 0 || usage.overageAllowed,
            remainingValidations: usage.remainingValidations,
            overageAllowed: usage.overageAllowed,
            monthlyValidationsUsed: usage.monthlyValidationsUsed,
            planValidationsLimit: usage.planValidationsLimit
        };
        return reply.status(200).send(response);
    }
})
