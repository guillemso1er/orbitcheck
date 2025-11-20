export const REASON_CODES = {
  // Address
  ADDRESS_PO_BOX: 'address.po_box',
  ADDRESS_POSTAL_CITY_MISMATCH: 'address.postal_city_mismatch',
  ADDRESS_GEO_OUT_OF_BOUNDS: 'address.geo_out_of_bounds',
  ADDRESS_GEOCODE_FAILED: 'address.geocode_failed',
  ADDRESS_NOT_FOUND: 'address.not_found',
  MISSING_REQUIRED_FIELDS: 'missing_required_fields',

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
  ORDER_CUSTOMER_DEDUPE_MATCH: 'ORDER_CUSTOMER_DEDUPE_MATCH',
  ORDER_ADDRESS_DEDUPE_MATCH: 'ORDER_ADDRESS_DEDUPE_MATCH',
  ORDER_PO_BOX_BLOCK: 'ORDER_PO_BOX_BLOCK',
  ORDER_ADDRESS_MISMATCH: 'ORDER_ADDRESS_MISMATCH',
  ORDER_GEO_OUT_OF_BOUNDS: 'ORDER_GEO_OUT_OF_BOUNDS',
  ORDER_GEOCODE_FAILED: 'ORDER_GEOCODE_FAILED',
  ORDER_INVALID_ADDRESS: 'ORDER_INVALID_ADDRESS',
  ORDER_DISPOSABLE_EMAIL: 'ORDER_DISPOSABLE_EMAIL',
  ORDER_INVALID_PHONE: 'ORDER_INVALID_PHONE',
  ORDER_DUPLICATE_DETECTED: 'ORDER_DUPLICATE_DETECTED',
  ORDER_COD_RISK: 'ORDER_COD_RISK',
  ORDER_HIGH_RISK_RTO: 'ORDER_HIGH_RISK_RTO',
  ORDER_HIGH_VALUE: 'ORDER_HIGH_VALUE',
  ORDER_INVALID_EMAIL: 'ORDER_INVALID_EMAIL',
  ORDER_HOLD_FOR_REVIEW: 'ORDER_HOLD_FOR_REVIEW',
  ORDER_SERVER_ERROR: 'ORDER_SERVER_ERROR',

  // Deduplication
  DEDUP_SERVER_ERROR: 'dedupe.server_error',

  // Webhook
  WEBHOOK_SEND_FAILED: 'webhook.send_failed',
} as const;

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
  DEDUPE_COMPLETED: 'dedupe_completed',
  JOB_COMPLETED: 'job_completed',
} as const;

export const PAYLOAD_TYPES = {
  VALIDATION: 'validation',
  ORDER: 'order',
  CUSTOM: 'custom',
} as const;

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

export const DEDUPE_FUZZY_LIMIT = 5 as const;

export const PHONE_NORMALIZE_REGEX = /[^\d+]/g;

export const FULL_NAME_SEPARATOR = ' ' as const;