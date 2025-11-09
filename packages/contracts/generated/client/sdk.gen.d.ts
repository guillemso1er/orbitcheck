import type { Client, Options as Options2, TDataShape } from './client';
import type { BatchDedupeData, BatchDedupeErrors, BatchDedupeResponses, BatchValidateData, BatchValidateErrors, BatchValidateResponses, CheckValidationLimitsData, CheckValidationLimitsErrors, CheckValidationLimitsResponses, CreateApiKeyData, CreateApiKeyErrors, CreateApiKeyResponses, CreateCheckoutSessionData, CreateCheckoutSessionErrors, CreateCheckoutSessionResponses, CreateCustomerPortalSessionData, CreateCustomerPortalSessionErrors, CreateCustomerPortalSessionResponses, CreatePersonalAccessTokenData, CreatePersonalAccessTokenErrors, CreatePersonalAccessTokenResponses, CreateProjectData, CreateProjectErrors, CreateProjectResponses, CreateUserData, CreateUserErrors, CreateUserResponses, CreateWebhookData, CreateWebhookErrors, CreateWebhookResponses, DedupeAddressData, DedupeAddressErrors, DedupeAddressResponses, DedupeCustomerData, DedupeCustomerErrors, DedupeCustomerResponses, DeleteCustomRuleData, DeleteCustomRuleErrors, DeleteCustomRuleResponses, DeleteLogData, DeleteLogErrors, DeleteLogResponses, DeleteProjectData, DeleteProjectErrors, DeleteProjectResponses, DeleteWebhookData, DeleteWebhookErrors, DeleteWebhookResponses, EraseDataData, EraseDataErrors, EraseDataResponses, EvaluateOrderData, EvaluateOrderErrors, EvaluateOrderResponses, GetAvailablePlansData, GetAvailablePlansErrors, GetAvailablePlansResponses, GetAvailableRulesData, GetAvailableRulesErrors, GetAvailableRulesResponses, GetErrorCodeCatalogData, GetErrorCodeCatalogErrors, GetErrorCodeCatalogResponses, GetJobStatusByIdData, GetJobStatusByIdErrors, GetJobStatusByIdResponses, GetLogsData, GetLogsErrors, GetLogsResponses, GetReasonCodeCatalogData, GetReasonCodeCatalogErrors, GetReasonCodeCatalogResponses, GetSettingsData, GetSettingsErrors, GetSettingsResponses, GetUsageData, GetUsageErrors, GetUsageResponses, GetUserPlanData, GetUserPlanErrors, GetUserPlanResponses, GetUserProjectsData, GetUserProjectsErrors, GetUserProjectsResponses, ListApiKeysData, ListApiKeysErrors, ListApiKeysResponses, ListPersonalAccessTokensData, ListPersonalAccessTokensErrors, ListPersonalAccessTokensResponses, ListUsersData, ListUsersErrors, ListUsersResponses, ListWebhooksData, ListWebhooksErrors, ListWebhooksResponses, LoginUserData, LoginUserErrors, LoginUserResponses, LogoutUserData, LogoutUserErrors, LogoutUserResponses, MergeDeduplicatedData, MergeDeduplicatedErrors, MergeDeduplicatedResponses, NormalizeAddressData, NormalizeAddressErrors, NormalizeAddressResponses, RegisterCustomRulesData, RegisterCustomRulesErrors, RegisterCustomRulesResponses, RegisterUserData, RegisterUserErrors, RegisterUserResponses, RevokeApiKeyData, RevokeApiKeyErrors, RevokeApiKeyResponses, RevokePersonalAccessTokenData, RevokePersonalAccessTokenErrors, RevokePersonalAccessTokenResponses, TestRulesAgainstPayloadData, TestRulesAgainstPayloadErrors, TestRulesAgainstPayloadResponses, TestWebhookData, TestWebhookErrors, TestWebhookResponses, UpdateSettingsData, UpdateSettingsErrors, UpdateSettingsResponses, UpdateUserPlanData, UpdateUserPlanErrors, UpdateUserPlanResponses, ValidateAddressData, ValidateAddressErrors, ValidateAddressResponses, ValidateEmailData, ValidateEmailErrors, ValidateEmailResponses, ValidateNameData, ValidateNameErrors, ValidateNameResponses, ValidatePhoneData, ValidatePhoneErrors, ValidatePhoneResponses, ValidateTaxIdData, ValidateTaxIdErrors, ValidateTaxIdResponses, VerifyPhoneOtpData, VerifyPhoneOtpErrors, VerifyPhoneOtpResponses } from './types.gen';
export type Options<TData extends TDataShape = TDataShape, ThrowOnError extends boolean = boolean> = Options2<TData, ThrowOnError> & {
    /**
     * You can provide a client instance returned by `createClient()` instead of
     * individual options. This might be also useful if you want to implement a
     * custom client.
     */
    client?: Client;
    /**
     * You can pass arbitrary values through the `meta` object. This can be
     * used to access values that aren't defined as part of the SDK function.
     */
    meta?: Record<string, unknown>;
};
/**
 * User login
 *
 * Authenticates a user and returns JWT token
 */
export declare const loginUser: <ThrowOnError extends boolean = false>(options: Options<LoginUserData, ThrowOnError>) => import("./client").RequestResult<LoginUserResponses, LoginUserErrors, ThrowOnError, "fields">;
/**
 * Register new user
 *
 * Creates a new user account with default project and API key
 */
export declare const registerUser: <ThrowOnError extends boolean = false>(options: Options<RegisterUserData, ThrowOnError>) => import("./client").RequestResult<RegisterUserResponses, RegisterUserErrors, ThrowOnError, "fields">;
/**
 * User logout
 *
 * Logs out the current user by clearing the session
 */
export declare const logoutUser: <ThrowOnError extends boolean = false>(options?: Options<LogoutUserData, ThrowOnError>) => import("./client").RequestResult<LogoutUserResponses, LogoutUserErrors, ThrowOnError, "fields">;
/**
 * List API keys
 *
 * Retrieves API keys for the authenticated project
 */
export declare const listApiKeys: <ThrowOnError extends boolean = false>(options?: Options<ListApiKeysData, ThrowOnError>) => import("./client").RequestResult<ListApiKeysResponses, ListApiKeysErrors, ThrowOnError, "fields">;
/**
 * Create API key
 *
 * Generates a new API key for the authenticated project
 */
export declare const createApiKey: <ThrowOnError extends boolean = false>(options: Options<CreateApiKeyData, ThrowOnError>) => import("./client").RequestResult<CreateApiKeyResponses, CreateApiKeyErrors, ThrowOnError, "fields">;
/**
 * Revoke API key
 *
 * Revokes an API key by setting its status to revoked
 */
export declare const revokeApiKey: <ThrowOnError extends boolean = false>(options: Options<RevokeApiKeyData, ThrowOnError>) => import("./client").RequestResult<RevokeApiKeyResponses, RevokeApiKeyErrors, ThrowOnError, "fields">;
/**
 * List webhooks
 *
 * Retrieves all webhooks for the authenticated project
 */
export declare const listWebhooks: <ThrowOnError extends boolean = false>(options?: Options<ListWebhooksData, ThrowOnError>) => import("./client").RequestResult<ListWebhooksResponses, ListWebhooksErrors, ThrowOnError, "fields">;
/**
 * Create webhook
 *
 * Creates a new webhook subscription for the authenticated project
 */
export declare const createWebhook: <ThrowOnError extends boolean = false>(options: Options<CreateWebhookData, ThrowOnError>) => import("./client").RequestResult<CreateWebhookResponses, CreateWebhookErrors, ThrowOnError, "fields">;
/**
 * Delete webhook
 *
 * Deletes a webhook subscription
 */
export declare const deleteWebhook: <ThrowOnError extends boolean = false>(options: Options<DeleteWebhookData, ThrowOnError>) => import("./client").RequestResult<DeleteWebhookResponses, DeleteWebhookErrors, ThrowOnError, "fields">;
/**
 * Test Webhook
 *
 * Sends a sample payload to the provided webhook URL and returns the response. Useful for testing webhook configurations.
 */
export declare const testWebhook: <ThrowOnError extends boolean = false>(options: Options<TestWebhookData, ThrowOnError>) => import("./client").RequestResult<TestWebhookResponses, TestWebhookErrors, ThrowOnError, "fields">;
/**
 * Get available rules
 *
 * Retrieves a list of all available validation rules and their configurations
 */
export declare const getAvailableRules: <ThrowOnError extends boolean = false>(options?: Options<GetAvailableRulesData, ThrowOnError>) => import("./client").RequestResult<GetAvailableRulesResponses, GetAvailableRulesErrors, ThrowOnError, "fields">;
/**
 * Get error code catalog
 *
 * Retrieves a catalog of all possible error codes and their descriptions
 */
export declare const getErrorCodeCatalog: <ThrowOnError extends boolean = false>(options?: Options<GetErrorCodeCatalogData, ThrowOnError>) => import("./client").RequestResult<GetErrorCodeCatalogResponses, GetErrorCodeCatalogErrors, ThrowOnError, "fields">;
/**
 * Get reason code catalog
 *
 * Retrieves a catalog of all possible reason codes and their descriptions
 */
export declare const getReasonCodeCatalog: <ThrowOnError extends boolean = false>(options?: Options<GetReasonCodeCatalogData, ThrowOnError>) => import("./client").RequestResult<GetReasonCodeCatalogResponses, GetReasonCodeCatalogErrors, ThrowOnError, "fields">;
/**
 * Test rules against payload
 *
 * Tests rules against a sample payload and returns triggered rules
 */
export declare const testRulesAgainstPayload: <ThrowOnError extends boolean = false>(options: Options<TestRulesAgainstPayloadData, ThrowOnError>) => import("./client").RequestResult<TestRulesAgainstPayloadResponses, TestRulesAgainstPayloadErrors, ThrowOnError, "fields">;
/**
 * Register custom rules
 *
 * Registers new custom validation rules for the project
 */
export declare const registerCustomRules: <ThrowOnError extends boolean = false>(options: Options<RegisterCustomRulesData, ThrowOnError>) => import("./client").RequestResult<RegisterCustomRulesResponses, RegisterCustomRulesErrors, ThrowOnError, "fields">;
/**
 * Delete custom rule
 *
 * Deletes a custom validation rule by its ID
 */
export declare const deleteCustomRule: <ThrowOnError extends boolean = false>(options: Options<DeleteCustomRuleData, ThrowOnError>) => import("./client").RequestResult<DeleteCustomRuleResponses, DeleteCustomRuleErrors, ThrowOnError, "fields">;
/**
 * Validate email
 *
 * Validates an email address
 */
export declare const validateEmail: <ThrowOnError extends boolean = false>(options: Options<ValidateEmailData, ThrowOnError>) => import("./client").RequestResult<ValidateEmailResponses, ValidateEmailErrors, ThrowOnError, "fields">;
/**
 * Validate phone
 *
 * Validates a phone number
 */
export declare const validatePhone: <ThrowOnError extends boolean = false>(options: Options<ValidatePhoneData, ThrowOnError>) => import("./client").RequestResult<ValidatePhoneResponses, ValidatePhoneErrors, ThrowOnError, "fields">;
/**
 * Validate address
 *
 * Validates an address
 */
export declare const validateAddress: <ThrowOnError extends boolean = false>(options: Options<ValidateAddressData, ThrowOnError>) => import("./client").RequestResult<ValidateAddressResponses, ValidateAddressErrors, ThrowOnError, "fields">;
/**
 * Validate tax ID
 *
 * Validates a tax identification number
 */
export declare const validateTaxId: <ThrowOnError extends boolean = false>(options: Options<ValidateTaxIdData, ThrowOnError>) => import("./client").RequestResult<ValidateTaxIdResponses, ValidateTaxIdErrors, ThrowOnError, "fields">;
/**
 * Validate name
 *
 * Validates and normalizes a name string
 */
export declare const validateName: <ThrowOnError extends boolean = false>(options: Options<ValidateNameData, ThrowOnError>) => import("./client").RequestResult<ValidateNameResponses, ValidateNameErrors, ThrowOnError, "fields">;
/**
 * Evaluate order for risk and rules
 *
 * Evaluates an order for deduplication, validation, and applies business rules
 */
export declare const evaluateOrder: <ThrowOnError extends boolean = false>(options: Options<EvaluateOrderData, ThrowOnError>) => import("./client").RequestResult<EvaluateOrderResponses, EvaluateOrderErrors, ThrowOnError, "fields">;
/**
 * Verify phone OTP
 *
 * Verifies OTP sent to phone number
 */
export declare const verifyPhoneOtp: <ThrowOnError extends boolean = false>(options: Options<VerifyPhoneOtpData, ThrowOnError>) => import("./client").RequestResult<VerifyPhoneOtpResponses, VerifyPhoneOtpErrors, ThrowOnError, "fields">;
/**
 * Get event logs
 *
 * Retrieves event logs for the project with optional filters
 */
export declare const getLogs: <ThrowOnError extends boolean = false>(options?: Options<GetLogsData, ThrowOnError>) => import("./client").RequestResult<GetLogsResponses, GetLogsErrors, ThrowOnError, "fields">;
/**
 * Get usage statistics
 *
 * Retrieves usage statistics for the project
 */
export declare const getUsage: <ThrowOnError extends boolean = false>(options?: Options<GetUsageData, ThrowOnError>) => import("./client").RequestResult<GetUsageResponses, GetUsageErrors, ThrowOnError, "fields">;
/**
 * Delete log entry
 *
 * Deletes a specific log entry
 */
export declare const deleteLog: <ThrowOnError extends boolean = false>(options: Options<DeleteLogData, ThrowOnError>) => import("./client").RequestResult<DeleteLogResponses, DeleteLogErrors, ThrowOnError, "fields">;
/**
 * List Personal Access Tokens
 *
 * Retrieves personal access tokens for the authenticated user
 */
export declare const listPersonalAccessTokens: <ThrowOnError extends boolean = false>(options?: Options<ListPersonalAccessTokensData, ThrowOnError>) => import("./client").RequestResult<ListPersonalAccessTokensResponses, ListPersonalAccessTokensErrors, ThrowOnError, "fields">;
/**
 * Create Personal Access Token
 *
 * Creates a new personal access token for management API access
 */
export declare const createPersonalAccessToken: <ThrowOnError extends boolean = false>(options: Options<CreatePersonalAccessTokenData, ThrowOnError>) => import("./client").RequestResult<CreatePersonalAccessTokenResponses, CreatePersonalAccessTokenErrors, ThrowOnError, "fields">;
/**
 * Revoke Personal Access Token
 *
 * Revokes a personal access token by disabling it
 */
export declare const revokePersonalAccessToken: <ThrowOnError extends boolean = false>(options: Options<RevokePersonalAccessTokenData, ThrowOnError>) => import("./client").RequestResult<RevokePersonalAccessTokenResponses, RevokePersonalAccessTokenErrors, ThrowOnError, "fields">;
/**
 * Get tenant settings
 *
 * Retrieves tenant settings including country defaults, formatting, and risk thresholds
 *
 */
export declare const getSettings: <ThrowOnError extends boolean = false>(options?: Options<GetSettingsData, ThrowOnError>) => import("./client").RequestResult<GetSettingsResponses, GetSettingsErrors, ThrowOnError, "fields">;
/**
 * Update tenant settings
 *
 * Updates tenant settings including country defaults, formatting, and risk thresholds
 *
 */
export declare const updateSettings: <ThrowOnError extends boolean = false>(options: Options<UpdateSettingsData, ThrowOnError>) => import("./client").RequestResult<UpdateSettingsResponses, UpdateSettingsErrors, ThrowOnError, "fields">;
/**
 * Erase user data
 *
 * Initiates data erasure for GDPR/CCPA compliance
 */
export declare const eraseData: <ThrowOnError extends boolean = false>(options: Options<EraseDataData, ThrowOnError>) => import("./client").RequestResult<EraseDataResponses, EraseDataErrors, ThrowOnError, "fields">;
/**
 * Create Stripe Checkout session
 *
 * Creates a Stripe Checkout session with base plan and usage-based line items
 */
export declare const createCheckoutSession: <ThrowOnError extends boolean = false>(options?: Options<CreateCheckoutSessionData, ThrowOnError>) => import("./client").RequestResult<CreateCheckoutSessionResponses, CreateCheckoutSessionErrors, ThrowOnError, "fields">;
/**
 * Create Stripe Customer Portal session
 *
 * Creates a Stripe Customer Portal session for managing billing
 */
export declare const createCustomerPortalSession: <ThrowOnError extends boolean = false>(options?: Options<CreateCustomerPortalSessionData, ThrowOnError>) => import("./client").RequestResult<CreateCustomerPortalSessionResponses, CreateCustomerPortalSessionErrors, ThrowOnError, "fields">;
/**
 * List users
 *
 * Retrieves a list of users in the project
 */
export declare const listUsers: <ThrowOnError extends boolean = false>(options?: Options<ListUsersData, ThrowOnError>) => import("./client").RequestResult<ListUsersResponses, ListUsersErrors, ThrowOnError, "fields">;
/**
 * Create user
 *
 * Creates a new user in the project
 */
export declare const createUser: <ThrowOnError extends boolean = false>(options: Options<CreateUserData, ThrowOnError>) => import("./client").RequestResult<CreateUserResponses, CreateUserErrors, ThrowOnError, "fields">;
/**
 * Normalize Address (Cheap)
 *
 * Performs basic address normalization without geocoding or external lookups
 */
export declare const normalizeAddress: <ThrowOnError extends boolean = false>(options: Options<NormalizeAddressData, ThrowOnError>) => import("./client").RequestResult<NormalizeAddressResponses, NormalizeAddressErrors, ThrowOnError, "fields">;
/**
 * Deduplicate customer
 *
 * Searches for existing customers using deterministic and fuzzy matching
 */
export declare const dedupeCustomer: <ThrowOnError extends boolean = false>(options: Options<DedupeCustomerData, ThrowOnError>) => import("./client").RequestResult<DedupeCustomerResponses, DedupeCustomerErrors, ThrowOnError, "fields">;
/**
 * Deduplicate address
 *
 * Searches for existing addresses using deterministic and fuzzy matching
 */
export declare const dedupeAddress: <ThrowOnError extends boolean = false>(options: Options<DedupeAddressData, ThrowOnError>) => import("./client").RequestResult<DedupeAddressResponses, DedupeAddressErrors, ThrowOnError, "fields">;
/**
 * Merge deduplicated records
 *
 * Merges multiple customer or address records into a canonical one
 */
export declare const mergeDeduplicated: <ThrowOnError extends boolean = false>(options: Options<MergeDeduplicatedData, ThrowOnError>) => import("./client").RequestResult<MergeDeduplicatedResponses, MergeDeduplicatedErrors, ThrowOnError, "fields">;
/**
 * Batch validate data
 *
 * Performs batch validation of emails, phones, addresses, or tax IDs asynchronously
 */
export declare const batchValidate: <ThrowOnError extends boolean = false>(options: Options<BatchValidateData, ThrowOnError>) => import("./client").RequestResult<BatchValidateResponses, BatchValidateErrors, ThrowOnError, "fields">;
/**
 * Batch deduplicate data
 *
 * Performs batch deduplication of customers or addresses asynchronously
 */
export declare const batchDedupe: <ThrowOnError extends boolean = false>(options: Options<BatchDedupeData, ThrowOnError>) => import("./client").RequestResult<BatchDedupeResponses, BatchDedupeErrors, ThrowOnError, "fields">;
/**
 * Get job status
 *
 * Retrieves the status and results of an asynchronous job
 */
export declare const getJobStatusById: <ThrowOnError extends boolean = false>(options: Options<GetJobStatusByIdData, ThrowOnError>) => import("./client").RequestResult<GetJobStatusByIdResponses, GetJobStatusByIdErrors, ThrowOnError, "fields">;
/**
 * List user's projects
 *
 * Retrieves the list of projects for the authenticated user along with plan information
 */
export declare const getUserProjects: <ThrowOnError extends boolean = false>(options?: Options<GetUserProjectsData, ThrowOnError>) => import("./client").RequestResult<GetUserProjectsResponses, GetUserProjectsErrors, ThrowOnError, "fields">;
/**
 * Create new project
 *
 * Creates a new project for the authenticated user
 */
export declare const createProject: <ThrowOnError extends boolean = false>(options: Options<CreateProjectData, ThrowOnError>) => import("./client").RequestResult<CreateProjectResponses, CreateProjectErrors, ThrowOnError, "fields">;
/**
 * Delete project
 *
 * Deletes a project by ID for the authenticated user
 */
export declare const deleteProject: <ThrowOnError extends boolean = false>(options: Options<DeleteProjectData, ThrowOnError>) => import("./client").RequestResult<DeleteProjectResponses, DeleteProjectErrors, ThrowOnError, "fields">;
/**
 * Get current user plan
 *
 * Retrieves the current plan and usage information for the authenticated user
 */
export declare const getUserPlan: <ThrowOnError extends boolean = false>(options?: Options<GetUserPlanData, ThrowOnError>) => import("./client").RequestResult<GetUserPlanResponses, GetUserPlanErrors, ThrowOnError, "fields">;
/**
 * Update user plan
 *
 * Updates the user's subscription plan
 */
export declare const updateUserPlan: <ThrowOnError extends boolean = false>(options: Options<UpdateUserPlanData, ThrowOnError>) => import("./client").RequestResult<UpdateUserPlanResponses, UpdateUserPlanErrors, ThrowOnError, "fields">;
/**
 * Get available plans
 *
 * Returns all available subscription plans
 */
export declare const getAvailablePlans: <ThrowOnError extends boolean = false>(options?: Options<GetAvailablePlansData, ThrowOnError>) => import("./client").RequestResult<GetAvailablePlansResponses, GetAvailablePlansErrors, ThrowOnError, "fields">;
/**
 * Check validation limits
 *
 * Checks if the user has enough validation quota remaining
 */
export declare const checkValidationLimits: <ThrowOnError extends boolean = false>(options: Options<CheckValidationLimitsData, ThrowOnError>) => import("./client").RequestResult<CheckValidationLimitsResponses, CheckValidationLimitsErrors, ThrowOnError, "fields">;
//# sourceMappingURL=sdk.gen.d.ts.map