const mockModule = {
    API_V1_ROUTES: {
        BATCH: {
            BATCH_DEDUPLICATE_DATA: '/v1/batch/dedupe',
            BATCH_VALIDATE_DATA: '/v1/batch/validate',
        },
        DEDUPE: {
            DEDUPLICATE_ADDRESS: '/v1/dedupe/address',
            DEDUPLICATE_CUSTOMER: '/v1/dedupe/customer',
            MERGE_DEDUPLICATED_RECORDS: '/v1/dedupe/merge',
        },
        JOBS: {
            GET_JOB_STATUS: '/v1/jobs/:id',
        },
        NORMALIZE: {
            NORMALIZE_ADDRESS_CHEAP: '/v1/normalize/address',
        },
        ORDERS: {
            EVALUATE_ORDER_FOR_RISK_AND_RULES: '/v1/orders/evaluate',
        },
        VALIDATE: {
            VALIDATE_ADDRESS: '/v1/validate/address',
            VALIDATE_EMAIL_ADDRESS: '/v1/validate/email',
            VALIDATE_NAME: '/v1/validate/name',
            VALIDATE_PHONE_NUMBER: '/v1/validate/phone',
            VALIDATE_TAX_ID: '/v1/validate/tax-id',
        },
        VERIFY: {
            VERIFY_PHONE_OTP: '/v1/verify/phone',
        },
    },
    MGMT_V1_ROUTES: {
        API_KEYS: {
            CREATE_API_KEY: '/v1/api-keys',
            LIST_API_KEYS: '/v1/api-keys',
            REVOKE_API_KEY: '/v1/api-keys/:id',
        },
        BILLING: {
            CREATE_STRIPE_CHECKOUT_SESSION: '/v1/billing/checkout',
            CREATE_STRIPE_CUSTOMER_PORTAL_SESSION: '/v1/billing/portal',
        },
        DATA: {
            ERASE_USER_DATA: '/v1/data/erase',
            GET_EVENT_LOGS: '/v1/data/logs',
            GET_USAGE_STATISTICS: '/v1/data/usage',
        },
        LOGS: {
            DELETE_LOG_ENTRY: '/v1/logs/:id',
        },
        RULES: {
            GET_AVAILABLE_RULES: '/v1/rules',
            GET_ERROR_CODE_CATALOG: '/v1/rules/error-codes',
            GET_REASON_CODE_CATALOG: '/v1/rules/catalog',
            REGISTER_CUSTOM_RULES: '/v1/rules/register',
            TEST_RULES_AGAINST_PAYLOAD: '/v1/rules/test',
        },
        SETTINGS: {
            GET_TENANT_SETTINGS: '/v1/settings',
            UPDATE_TENANT_SETTINGS: '/v1/settings',
        },
        WEBHOOKS: {
            CREATE_WEBHOOK: '/v1/webhooks',
            DELETE_WEBHOOK: '/v1/webhooks/:id',
            LIST_WEBHOOKS: '/v1/webhooks',
            TEST_WEBHOOK: '/v1/webhooks/test',
        },
    },
    createApiClient: () => ({
        registerUser: jest.fn().mockResolvedValue({
            token: 'test-token',
            user: { id: 'user-id', email: 'test@example.com' }
        }),
        loginUser: jest.fn().mockResolvedValue({
            token: 'test-token',
            user: { id: 'user-id', email: 'test@example.com' }
        }),
        getUsage: jest.fn().mockResolvedValue({
            period: '7d',
            totals: { validations: 1000, orders: 500 },
            by_day: [
                { date: '2023-01-01', validations: 100, orders: 50 },
                { date: '2023-01-02', validations: 150, orders: 75 }
            ],
            top_reason_codes: [
                { code: 'TEST1', count: 100 },
                { code: 'TEST2', count: 50 }
            ],
            cache_hit_ratio: 85.5,
            request_id: 'test-request-id'
        }),
        getLogs: jest.fn().mockResolvedValue({
            data: [{
                id: 'log1', type: 'validation', endpoint: '/validate/email',
                reason_codes: [], status: 200, created_at: new Date().toISOString(), meta: {}
            }],
            next_cursor: null, total_count: 1
        }),
        listApiKeys: jest.fn().mockResolvedValue({
            data: [{
                id: 'key1', prefix: 'test-prefix',
                status: 'active', created_at: new Date().toISOString()
            }]
        }),
        createApiKey: jest.fn().mockResolvedValue({
            prefix: 'new-prefix',
            full_key: 'new-full-key-1234567890'
        }),
        revokeApiKey: jest.fn().mockResolvedValue({}),
        testWebhook: jest.fn().mockResolvedValue({
            response: { status: 200 },
            request_id: 'test-request-id'
        }),
        batchValidateData: jest.fn().mockResolvedValue({
            job_id: 'test-job-id',
            request_id: 'test-request-id'
        }),
        batchDedupeData: jest.fn().mockResolvedValue({
            job_id: 'test-job-id',
            request_id: 'test-request-id'
        }),
        getJobStatus: jest.fn().mockResolvedValue({
            job_id: 'test-job-id',
            status: 'completed',
            progress: { completed: 100, total: 100 },
            results: [],
            request_id: 'test-request-id'
        }),
        evaluateOrder: jest.fn().mockResolvedValue({
            validations: {
                email: { valid: true, reason_codes: [] },
                phone: { valid: true, reason_codes: [] },
                address: {
                    valid: true,
                    reason_codes: [],
                    normalized: {},
                    geo: { lat: 0, lng: 0 }
                }
            },
            customer_dedupe: { matches: [] },
            address_dedupe: { matches: [] },
            request_id: 'test-request-id'
        })
    }),
    openapiYaml: 'mocked-yaml',
};

module.exports = mockModule;