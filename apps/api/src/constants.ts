export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
} as const;

export const ERROR_CODES = {
  INVALID_URL: 'invalid_url',
  MISSING_PAYLOAD: 'missing_payload',
  INVALID_TYPE: 'invalid_type',
  INVALID_IDS: 'invalid_ids',
  NOT_FOUND: 'not_found',
  UNAUTHORIZED: 'unauthorized',
  INVALID_TOKEN: 'invalid_token',
  NO_PROJECT: 'no_project',
  USER_EXISTS: 'user_exists',
  INVALID_CREDENTIALS: 'invalid_credentials',
  SERVER_ERROR: 'server_error',
  WEBHOOK_SEND_FAILED: 'send_failed',
  RATE_LIMITED: 'rate_limited',
} as const;

export const ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_URL]: 'Valid HTTPS/HTTP URL required',
  [ERROR_CODES.MISSING_PAYLOAD]: 'Custom payload required for custom type',
  [ERROR_CODES.INVALID_TYPE]: 'Invalid payload_type',
  [ERROR_CODES.INVALID_IDS]: 'Invalid or mismatched IDs',
  [ERROR_CODES.NOT_FOUND]: 'API key not found',
  [ERROR_CODES.UNAUTHORIZED]: 'Missing JWT token',
  [ERROR_CODES.INVALID_TOKEN]: 'Invalid token',
  [ERROR_CODES.NO_PROJECT]: 'No default project found',
  [ERROR_CODES.USER_EXISTS]: 'User already exists',
  [ERROR_CODES.INVALID_CREDENTIALS]: 'Invalid email or password',
  [ERROR_CODES.SERVER_ERROR]: 'Twilio Verify not configured',
  [ERROR_CODES.RATE_LIMITED]: 'Rate limit exceeded',
} as const;

export const REASON_CODES = {
  // Address
  ADDRESS_PO_BOX: 'address.po_box',
  ADDRESS_POSTAL_CITY_MISMATCH: 'address.postal_city_mismatch',
  ADDRESS_GEO_OUT_OF_BOUNDS: 'address.geo_out_of_bounds',
  ADDRESS_GEOCODE_FAILED: 'address.geocode_failed',

  // Email
  EMAIL_INVALID_FORMAT: 'email.invalid_format',
  EMAIL_MX_NOT_FOUND: 'email.mx_not_found',
  EMAIL_DISPOSABLE_DOMAIN: 'email.disposable_domain',
  EMAIL_SERVER_ERROR: 'email.server_error',

  // Phone
  PHONE_INVALID_FORMAT: 'phone.invalid_format',
  PHONE_UNPARSEABLE: 'phone.unparseable',
  PHONE_OTP_SENT: 'phone.otp_sent',
  PHONE_OTP_SEND_FAILED: 'phone.otp_send_failed',
  PHONE_OTP_INVALID: 'phone.otp_invalid',

  // Tax ID
  TAXID_INVALID_FORMAT: 'taxid.invalid_format',
  TAXID_INVALID_CHECKSUM: 'taxid.invalid_checksum',
  TAXID_VIES_UNAVAILABLE: 'taxid.vies_unavailable',
  TAXID_VIES_INVALID: 'taxid.vies_invalid',

  // Order
  ORDER_CUSTOMER_DEDUPE_MATCH: 'order.customer_dedupe_match',
  ORDER_ADDRESS_DEDUPE_MATCH: 'order.address_dedupe_match',
  ORDER_PO_BOX_BLOCK: 'order.po_box_block',
  ORDER_ADDRESS_MISMATCH: 'order.address_mismatch',
  ORDER_GEO_OUT_OF_BOUNDS: 'order.geo_out_of_bounds',
  ORDER_GEOCODE_FAILED: 'order.geocode_failed',
  ORDER_INVALID_ADDRESS: 'order.invalid_address',
  ORDER_DISPOSABLE_EMAIL: 'order.disposable_email',
  ORDER_INVALID_PHONE: 'order.invalid_phone',
  ORDER_DUPLICATE_DETECTED: 'order.duplicate_detected',
  ORDER_COD_RISK: 'order.cod_risk',
  ORDER_HIGH_RISK_RTO: 'order.high_risk_rto',
  ORDER_HIGH_VALUE: 'order.high_value',
  ORDER_INVALID_EMAIL: 'order.invalid_email',
  ORDER_HOLD_FOR_REVIEW: 'order.hold_for_review',
  ORDER_SERVER_ERROR: 'order.server_error',

  // Deduplication
  DEDUP_SERVER_ERROR: 'dedupe.server_error',

  // Webhook
  WEBHOOK_SEND_FAILED: 'webhook.send_failed',
} as const;

export const STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
} as const;

export const PLAN_TYPES = {
  DEV: 'dev',
} as const;

export const PROJECT_NAMES = {
  DEFAULT: 'Default Project',
} as const;

export const API_KEY_NAMES = {
  DEFAULT: 'Default API Key',
} as const;

export const API_KEY_PREFIX = 'ok_' as const;

export const JWT_EXPIRES_IN = '7d' as const;

export const PG_UNIQUE_VIOLATION = '23505' as const;

export const MATCH_TYPES = {
  EXACT_EMAIL: 'exact_email',
  EXACT_PHONE: 'exact_phone',
  FUZZY_NAME: 'fuzzy_name',
  EXACT_ADDRESS: 'exact_address',
  EXACT_POSTAL: 'exact_postal',
  FUZZY_ADDRESS: 'fuzzy_address',
} as const;

export const DEDUPE_ACTIONS = {
  CREATE_NEW: 'create_new',
  MERGE_WITH: 'merge_with',
  REVIEW: 'review',
} as const;

export const MERGE_TYPES = {
  CUSTOMER: 'customer',
  ADDRESS: 'address',
} as const;

export const ORDER_ACTIONS = {
  APPROVE: 'approve',
  HOLD: 'hold',
  BLOCK: 'block',
} as const;

export const ORDER_TAGS = {
  POTENTIAL_DUPLICATE_CUSTOMER: 'potential_duplicate_customer',
  POTENTIAL_DUPLICATE_ADDRESS: 'potential_duplicate_address',
  PO_BOX_DETECTED: 'po_box_detected',
  VIRTUAL_ADDRESS: 'virtual_address',
  INVALID_ADDRESS: 'invalid_address',
  DISPOSABLE_EMAIL: 'disposable_email',
  DUPLICATE_ORDER: 'duplicate_order',
  COD_ORDER: 'cod_order',
  HIGH_RISK_RTO: 'high_risk_rto',
  HIGH_VALUE_ORDER: 'high_value_order',
} as const;

export const PAYMENT_METHODS = {
  CARD: 'card',
  COD: 'cod',
  BANK_TRANSFER: 'bank_transfer',
} as const;

export const EVENT_TYPES = {
  VALIDATION_RESULT: 'validation_result',
  ORDER_EVALUATED: 'order_evaluated',
} as const;

export const PAYLOAD_TYPES = {
  VALIDATION: 'validation',
  ORDER: 'order',
  CUSTOM: 'custom',
} as const;

export const USAGE_PERIOD = 'month' as const;

export const USAGE_DAYS = 31 as const;

export const LOGS_DEFAULT_LIMIT = 100 as const;

export const LOGS_MAX_LIMIT = 1000 as const;

export const TOP_REASONS_LIMIT = 10 as const;

export const CACHE_HIT_PLACEHOLDER = 0.95 as const;

export const SIMILARITY_EXACT = 1 as const;

export const SIMILARITY_FUZZY_THRESHOLD = 0.85 as const;

export const RISK_BLOCK_THRESHOLD = 70 as const;

export const RISK_HOLD_THRESHOLD = 40 as const;

export const RISK_CUSTOMER_DEDUPE = 20 as const;

export const RISK_ADDRESS_DEDUPE = 15 as const;

export const RISK_PO_BOX = 30 as const;

export const RISK_POSTAL_MISMATCH = 10 as const;

export const RISK_GEO_OUT = 40 as const;
export const RISK_GEOCODE_FAIL = 15 as const;         
export const RISK_INVALID_ADDR = 20 as const;         
export const RISK_INVALID_EMAIL_PHONE = 20 as const;  

export const RISK_COD = 20 as const;

export const RISK_COD_HIGH = 50 as const;

export const RISK_HIGH_VALUE = 15 as const;

export const HIGH_VALUE_THRESHOLD = 1000 as const;

export const DNS_TIMEOUT_MS = 1200 as const;

export const DOMAIN_CACHE_TTL_DAYS = 7 as const;

export const EMAIL_VALIDATION_TTL_DAYS = 30 as const;

export const ADDRESS_VALIDATION_TTL_DAYS = 7 as const;

export const TAXID_VALIDATION_TTL_DAYS = 1 as const;

export const PHONE_VALIDATION_TTL_DAYS = 30 as const;

export const IDEMPOTENCY_TTL_HOURS = 24 as const;

export const TTL_EMAIL = EMAIL_VALIDATION_TTL_DAYS * 24 * 3600;

export const TTL_ADDRESS = ADDRESS_VALIDATION_TTL_DAYS * 24 * 3600;

export const TTL_TAXID = TAXID_VALIDATION_TTL_DAYS * 24 * 3600;

export const TTL_PHONE = PHONE_VALIDATION_TTL_DAYS * 24 * 3600;

export const API_PATHS = {
  VALIDATE_EMAIL: '/v1/validate/email',
  VALIDATE_PHONE: '/v1/validate/phone',
  VALIDATE_ADDRESS: '/v1/validate/address',
  VALIDATE_TAXID: '/v1/validate/tax-id',
  VERIFY_PHONE: '/v1/verify/phone',
} as const;

export const TWILIO_CHANNEL_SMS = 'sms' as const;