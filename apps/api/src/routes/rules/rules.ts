import { MGMT_V1_ROUTES } from "@orbitcheck/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { ERROR_CODE_DESCRIPTIONS } from "../../errors.js";
import { REASON_CODES } from "../../validation.js";
import { validateAddress } from "../../validators/address.js";
import { validateEmail } from "../../validators/email.js";
import { validateName } from "../../validators/name.js";
import { validatePhone } from "../../validators/phone.js";
import { generateRequestId, MGMT_V1_SECURITY, securityHeader, sendServerError } from "../utils.js";
import { buildEnhancedAddressValidationResult, buildEnhancedEmailValidationResult, buildEnhancedNameValidationResult, buildEnhancedPhoneValidationResult, RiskScoreCalculator, RuleEvaluationResult, RuleEvaluator, TestPayloadJsonSchema, TestRulesResponse, validateDevice, validateIP, ValidationCacheManager, ValidationPayload } from "./test-rules.js";

// Custom rules are now stored in the database

const reasonCodes: any[] = Object.entries(REASON_CODES).map(([_key, code]) => {
  // Map from code to description, category, severity - this is a simplification; in practice, you'd have a full mapping
  const descriptions: Record<string, { description: string, category: string, severity: 'low' | 'medium' | 'high' }> = {
    [REASON_CODES.EMAIL_INVALID_FORMAT]: { description: 'Invalid email format', category: 'email', severity: 'low' },
    [REASON_CODES.EMAIL_MX_NOT_FOUND]: { description: 'No MX records found for domain', category: 'email', severity: 'medium' },
    [REASON_CODES.EMAIL_DISPOSABLE_DOMAIN]: { description: 'Disposable email domain detected', category: 'email', severity: 'high' },
    [REASON_CODES.EMAIL_SERVER_ERROR]: { description: 'Server error during validation', category: 'email', severity: 'high' },
    [REASON_CODES.PHONE_INVALID_FORMAT]: { description: 'Invalid phone number format', category: 'phone', severity: 'low' },
    [REASON_CODES.PHONE_UNPARSEABLE]: { description: 'Phone number could not be parsed', category: 'phone', severity: 'medium' },
    [REASON_CODES.PHONE_OTP_SENT]: { description: 'OTP sent successfully', category: 'phone', severity: 'low' },
    [REASON_CODES.PHONE_OTP_SEND_FAILED]: { description: 'Failed to send OTP', category: 'phone', severity: 'high' },
    [REASON_CODES.ADDRESS_PO_BOX]: { description: 'P.O. Box detected', category: 'address', severity: 'high' },
    [REASON_CODES.ADDRESS_POSTAL_CITY_MISMATCH]: { description: 'Postal code does not match city', category: 'address', severity: 'medium' },
    [REASON_CODES.ADDRESS_GEO_OUT_OF_BOUNDS]: { description: 'Address geocoded outside expected bounds', category: 'address', severity: 'high' },
    [REASON_CODES.ADDRESS_GEOCODE_FAILED]: { description: 'Failed to geocode address', category: 'address', severity: 'medium' },
    [REASON_CODES.TAXID_INVALID_FORMAT]: { description: 'Invalid tax ID format', category: 'taxid', severity: 'low' },
    [REASON_CODES.TAXID_INVALID_CHECKSUM]: { description: 'Invalid tax ID checksum', category: 'taxid', severity: 'medium' },
    [REASON_CODES.TAXID_VIES_INVALID]: { description: 'VAT number invalid per VIES', category: 'taxid', severity: 'high' },
    [REASON_CODES.TAXID_VIES_UNAVAILABLE]: { description: 'VIES service unavailable', category: 'taxid', severity: 'medium' },
    [REASON_CODES.ORDER_CUSTOMER_DEDUPE_MATCH]: { description: 'Potential duplicate customer detected', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_ADDRESS_DEDUPE_MATCH]: { description: 'Potential duplicate address detected', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_PO_BOX_BLOCK]: { description: 'Order blocked due to P.O. Box', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_ADDRESS_MISMATCH]: { description: 'Address validation mismatch', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_GEO_OUT_OF_BOUNDS]: { description: 'Order address geocoded outside bounds', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_GEOCODE_FAILED]: { description: 'Failed to geocode order address', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_INVALID_ADDRESS]: { description: 'Invalid address in order', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_DISPOSABLE_EMAIL]: { description: 'Disposable email in order', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_INVALID_PHONE]: { description: 'Invalid phone in order', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_DUPLICATE_DETECTED]: { description: 'Duplicate order detected', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_COD_RISK]: { description: 'Increased risk due to COD payment', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_HIGH_RISK_RTO]: { description: 'High risk return-to-origin detected', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_HIGH_VALUE]: { description: 'High value order flagged', category: 'order', severity: 'low' },
    [REASON_CODES.ORDER_INVALID_EMAIL]: { description: 'Invalid email in order', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_HOLD_FOR_REVIEW]: { description: 'Order held for manual review', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_SERVER_ERROR]: { description: 'Server error during order evaluation', category: 'order', severity: 'high' },
    [REASON_CODES.DEDUP_SERVER_ERROR]: { description: 'Server error during deduplication', category: 'dedupe', severity: 'high' },
    [REASON_CODES.WEBHOOK_SEND_FAILED]: { description: 'Failed to send webhook', category: 'webhook', severity: 'high' },
  };
  const desc = descriptions[code];
  return { code, description: desc ? desc.description : 'Unknown reason code', category: desc ? desc.category : 'unknown', severity: desc ? desc.severity : 'medium' };
});

const errorCodes: any[] = Object.entries(ERROR_CODE_DESCRIPTIONS).map(([code, desc]) => ({
  code,
  description: desc.description,
  category: desc.category,
  severity: desc.severity,
}));

export function registerRulesRoutes(app: FastifyInstance, pool: Pool, redis?: any): void {
  const rules: any[] = [
    {
      id: 'email_format',
      name: 'Email Format Validation',
      description: 'Validates the basic format of email addresses using RFC standards.',
      category: 'email',
      enabled: true,
    },
    {
      id: 'email_mx',
      name: 'Email MX Record Check',
      description: 'Verifies that the domain has valid MX records for email delivery.',
      category: 'email',
      enabled: true,
    },
    {
      id: 'email_disposable',
      name: 'Disposable Email Detection',
      description: 'Detects and flags temporary or disposable email services.',
      category: 'email',
      enabled: true,
    },
    {
      id: 'phone_format',
      name: 'Phone Number Format Validation',
      description: 'Parses and validates international phone number formats.',
      category: 'phone',
      enabled: true,
    },
    {
      id: 'phone_otp',
      name: 'Phone OTP Verification',
      description: 'Sends one-time password for phone number verification.',
      category: 'phone',
      enabled: true,
    },
    {
      id: 'address_po_box',
      name: 'PO Box Detection',
      description: 'Identifies and flags addresses using PO Box or similar mail services.',
      category: 'address',
      enabled: true,
    },
    {
      id: 'address_geocode',
      name: 'Address Geocoding Validation',
      description: 'Normalizes and validates physical addresses against geographic data.',
      category: 'address',
      enabled: true,
    },
    {
      id: 'taxid_format',
      name: 'Tax ID Format Check',
      description: 'Validates the format and checksum of tax identification numbers.',
      category: 'taxid',
      enabled: true,
    },
    {
      id: 'taxid_vies',
      name: 'VAT Validation via VIES',
      description: 'Verifies EU VAT numbers against the official VIES service.',
      category: 'taxid',
      enabled: true,
    },
    {
      id: 'order_dedupe',
      name: 'Order Deduplication',
      description: 'Checks for potential duplicate orders based on customer and address data.',
      category: 'order',
      enabled: true,
    },
    {
      id: 'order_risk',
      name: 'Order Risk Scoring',
      description: 'Evaluates overall risk of orders based on multiple validation signals.',
      category: 'order',
      enabled: true,
    },
  ];

  // Rules list endpoint
  app.get(MGMT_V1_ROUTES.RULES.GET_AVAILABLE_RULES, {
    schema: {
      summary: 'Get Available Rules',
      description: 'Returns a list of all available validation and risk assessment rules.',
      tags: ['Rules'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      response: {
        200: {
          description: 'List of rules',
          type: 'object',
          properties: {
            rules: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  category: { type: 'string' },
                  enabled: { type: 'boolean' },
                },
              },
            },
            request_id: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, rep: FastifyReply) => {
    try {
      const request_id = generateRequestId();

      // Get database custom rules
      const dbRules = await pool.query("SELECT id, name, logic as condition, severity, 'custom' as category, enabled FROM rules WHERE project_id = $1", [(request as any).project_id]);
      rules.push(...dbRules.rows.map(rule => ({ ...rule, condition: rule.logic || rule.condition })));
      const response: any = {
        rules,
        request_id,
      };
      return rep.send(response);
    } catch (error) {
      return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_AVAILABLE_RULES, generateRequestId());
    }
  });

  // Reason code catalog endpoint
  app.get(MGMT_V1_ROUTES.RULES.GET_REASON_CODE_CATALOG, {
    schema: {
      summary: 'Get Reason Code Catalog',
      description: 'Returns a comprehensive list of all possible reason codes with descriptions and severity levels.',
      tags: ['Rules'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      response: {
        200: {
          description: 'List of reason codes',
          type: 'object',
          properties: {
            reason_codes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  description: { type: 'string' },
                  category: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
              },
            },
            request_id: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, rep: FastifyReply) => {
    try {
      const request_id = generateRequestId();
      const response: any = {
        reason_codes: reasonCodes,
        request_id,
      };
      return rep.send(response);
    } catch (error) {
      return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_REASON_CODE_CATALOG, generateRequestId());
    }
  });

  // Error code catalog endpoint
  app.get(MGMT_V1_ROUTES.RULES.GET_ERROR_CODE_CATALOG, {
    schema: {
      summary: 'Get Error Code Catalog',
      description: 'Returns a comprehensive list of all possible error codes with descriptions and severity levels.',
      tags: ['Rules'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      response: {
        200: {
          description: 'List of error codes',
          type: 'object',
          properties: {
            error_codes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  description: { type: 'string' },
                  category: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
              },
            },
            request_id: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, rep: FastifyReply) => {
    try {
      const request_id = generateRequestId();
      const response: any = {
        error_codes: errorCodes,
        request_id,
      };
      return rep.send(response);
    } catch (error) {
      return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.GET_ERROR_CODE_CATALOG, generateRequestId());
    }
  });

  // Test rules endpoint (dry-run payload vs rules)
  app.post(MGMT_V1_ROUTES.RULES.TEST_RULES_AGAINST_PAYLOAD, {
    schema: {
      summary: 'Test Rules Against Payload',
      description: 'Performs comprehensive validation and rule evaluation with detailed results and performance metrics.',
      tags: ['Rules'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      body: TestPayloadJsonSchema,
      response: {
        200: {
          description: 'Comprehensive validation and rules test results',
          type: 'object',
          properties: {
            results: {
              type: 'object',
              properties: {
                email: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    risk_score: { type: 'number' },
                    processing_time_ms: { type: 'number' },
                    provider: { type: 'string' },
                    normalized: { type: 'string' },
                    disposable: { type: 'boolean' },
                    domain_reputation: { type: 'number' },
                    mx_records: { type: 'boolean' },
                    smtp_check: { type: 'boolean' },
                    catch_all: { type: 'boolean' },
                    role_account: { type: 'boolean' },
                    free_provider: { type: 'boolean' },
                    metadata: { type: 'object' }
                  }
                },
                phone: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    risk_score: { type: 'number' },
                    processing_time_ms: { type: 'number' },
                    provider: { type: 'string' },
                    e164: { type: 'string' },
                    country: { type: 'string' },
                    carrier: { type: 'string' },
                    line_type: { type: 'string' },
                    reachable: { type: 'boolean' },
                    ported: { type: 'boolean' },
                    roaming: { type: 'boolean' },
                    metadata: { type: 'object' }
                  }
                },
                address: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    risk_score: { type: 'number' },
                    processing_time_ms: { type: 'number' },
                    provider: { type: 'string' },
                    normalized: { type: 'object' },
                    po_box: { type: 'boolean' },
                    residential: { type: 'boolean' },
                    deliverable: { type: 'boolean' },
                    dpv_confirmed: { type: 'boolean' },
                    geocode: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
                    metadata: { type: 'object' }
                  }
                },
                name: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    risk_score: { type: 'number' },
                    processing_time_ms: { type: 'number' },
                    provider: { type: 'string' },
                    normalized: { type: 'string' },
                    parts: { type: 'object', properties: { first: { type: 'string' }, middle: { type: 'string' }, last: { type: 'string' } } },
                    gender: { type: 'string' },
                    salutation: { type: 'string' },
                    metadata: { type: 'object' }
                  }
                },
                ip: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    risk_score: { type: 'number' },
                    processing_time_ms: { type: 'number' },
                    provider: { type: 'string' },
                    country: { type: 'string' },
                    region: { type: 'string' },
                    city: { type: 'string' },
                    is_vpn: { type: 'boolean' },
                    is_proxy: { type: 'boolean' },
                    is_tor: { type: 'boolean' },
                    is_datacenter: { type: 'boolean' },
                    asn: { type: 'string' },
                    org: { type: 'string' },
                    metadata: { type: 'object' }
                  }
                },
                device: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    confidence: { type: 'number' },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    risk_score: { type: 'number' },
                    processing_time_ms: { type: 'number' },
                    provider: { type: 'string' },
                    type: { type: 'string' },
                    os: { type: 'string' },
                    browser: { type: 'string' },
                    is_bot: { type: 'boolean' },
                    fingerprint: { type: 'string' },
                    metadata: { type: 'object' }
                  }
                }
              }
            },
            rule_evaluations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rule_id: { type: 'string' },
                  rule_name: { type: 'string' },
                  description: { type: 'string' },
                  condition: { type: 'string' },
                  triggered: { type: 'boolean' },
                  action: { type: 'string', enum: ['approve', 'hold', 'block'] },
                  priority: { type: 'number' },
                  evaluation_time_ms: { type: 'number' },
                  confidence_score: { type: 'number' },
                  reason: { type: 'string' },
                  error: { type: 'string' },
                  metadata: { type: 'object' }
                }
              }
            },
            final_decision: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['approve', 'hold', 'block', 'review'] },
                confidence: { type: 'number' },
                reasons: { type: 'array', items: { type: 'string' } },
                risk_score: { type: 'number' },
                risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                recommended_actions: { type: 'array', items: { type: 'string' } }
              },
              required: ['action', 'confidence', 'reasons', 'risk_score', 'risk_level']
            },
            performance_metrics: {
              type: 'object',
              properties: {
                total_duration_ms: { type: 'number' },
                validation_duration_ms: { type: 'number' },
                rule_evaluation_duration_ms: { type: 'number' },
                parallel_validations: { type: 'boolean' },
                cache_hits: { type: 'number' },
                cache_misses: { type: 'number' }
              },
              required: ['total_duration_ms', 'validation_duration_ms', 'rule_evaluation_duration_ms', 'parallel_validations', 'cache_hits', 'cache_misses']
            },
            request_id: { type: 'string' },
            timestamp: { type: 'string' },
            project_id: { type: 'string' },
            environment: { type: 'string', enum: ['test', 'production'] },
            debug_info: {
              type: 'object',
              properties: {
                rules_evaluated: { type: 'number' },
                rules_triggered: { type: 'number' },
                validation_providers_used: { type: 'array', items: { type: 'string' } },
                errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, error: { type: 'string' } } } },
                warnings: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          required: ['results', 'rule_evaluations', 'final_decision', 'performance_metrics', 'request_id', 'timestamp', 'project_id', 'environment']
        },
        400: {
          description: 'Invalid request payload',
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'string' } }
          }
        },
        500: {
          description: 'Internal server error',
          type: 'object',
          properties: {
            error: { type: 'string' },
            request_id: { type: 'string' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = performance.now();
    const request_id = generateRequestId();
    const project_id = (request as any).project_id;

    // Initialize metrics
    const metrics = {
      cache_hits: 0,
      cache_misses: 0,
      validation_start: 0,
      validation_end: 0,
      rule_eval_start: 0,
      rule_eval_end: 0,
    };

    const debug_info: any = {
      rules_evaluated: 0,
      rules_triggered: 0,
      validation_providers_used: [],
      errors: [],
      warnings: []
    };

    try {

      // Initialize results
      const results: any = {};

      const body = request.body as ValidationPayload;
      // Parallel validation with caching
      metrics.validation_start = performance.now();
      const validationPromises = [];

      // Email validation
      if (body.email) {
        const cacheKey = ValidationCacheManager.generateKey('email', body.email, project_id);
        const cached = await ValidationCacheManager.get(redis, cacheKey);

        if (cached) {
          metrics.cache_hits++;
          results.email = cached;
        } else {
          metrics.cache_misses++;
          validationPromises.push(
            validateEmail(body.email, redis).then(async (emailResult) => {
              const result = buildEnhancedEmailValidationResult(emailResult);
              results.email = result;
              await ValidationCacheManager.set(redis, cacheKey, result);
              debug_info.validation_providers_used.push('email');
              return result;
            }).catch(error => {
              debug_info.errors.push({ field: 'email', error: error.message });
              return null;
            })
          );
        }
      }

      // Phone validation
      if (body.phone) {
        const cacheKey = ValidationCacheManager.generateKey('phone', body.phone, project_id);
        const cached = await ValidationCacheManager.get(redis, cacheKey);

        if (cached) {
          metrics.cache_hits++;
          results.phone = cached;
        } else {
          metrics.cache_misses++;
          validationPromises.push(
            validatePhone(body.phone, body.address?.country, redis).then(async (phoneResult) => {
              const result = buildEnhancedPhoneValidationResult(phoneResult);
              results.phone = result;
              await ValidationCacheManager.set(redis, cacheKey, result);
              debug_info.validation_providers_used.push('phone');
              return result;
            }).catch(error => {
              debug_info.errors.push({ field: 'phone', error: error.message });
              return null;
            })
          );
        }
      }

      // Address validation
      if (body.address && body.address.line1 && body.address.city && body.address.postal_code && body.address.country) {
        const addressString = JSON.stringify(body.address);
        const cacheKey = ValidationCacheManager.generateKey('address', addressString, project_id);
        const cached = await ValidationCacheManager.get(redis, cacheKey);

        if (cached) {
          metrics.cache_hits++;
          results.address = cached;
        } else {
          metrics.cache_misses++;
          validationPromises.push(
            validateAddress(body.address as any, pool, redis).then(async (addressResult) => {
              const result = buildEnhancedAddressValidationResult(addressResult, body.address);
              results.address = result;
              await ValidationCacheManager.set(redis, cacheKey, result);
              debug_info.validation_providers_used.push('address');
              return result;
            }).catch(error => {
              debug_info.errors.push({ field: 'address', error: error instanceof Error ? error.message : 'Unknown error' });
              return null;
            })
          );
        }
      }

      // Name validation
      if (body.name) {
        const nameResult = validateName(body.name);
        results.name = buildEnhancedNameValidationResult(nameResult);
        debug_info.validation_providers_used.push('name');
      }

      // IP validation (if provided)
      if (body.ip) {
        try {
          results.ip = await validateIP(body.ip, redis);
          debug_info.validation_providers_used.push('ip');
        } catch (error) {
          debug_info.errors.push({ field: 'ip', error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Device validation (if user_agent provided)
      if (body.user_agent) {
        try {
          results.device = await validateDevice(body.user_agent, redis);
          debug_info.validation_providers_used.push('device');
        } catch (error) {
          debug_info.errors.push({ field: 'device', error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Wait for all validations to complete
      await Promise.allSettled(validationPromises);
      metrics.validation_end = performance.now();

      // Calculate comprehensive risk score
      const riskAnalysis = RiskScoreCalculator.calculate(results);

      // Fetch and evaluate rules
      metrics.rule_eval_start = performance.now();

      // Get rules from database
      const rulesQuery = await pool.query(
        `SELECT * FROM rules 
       WHERE project_id = $1 AND enabled = true 
       ORDER BY priority DESC, created_at ASC`,
        [project_id]
      );

      const rules = rulesQuery.rows;
      debug_info.rules_evaluated = rules.length;

      // Evaluate rules with enhanced context
      const ruleEvaluations: RuleEvaluationResult[] = [];
      const evaluationContext = {
        ...results,
        risk_score: riskAnalysis.score,
        risk_level: riskAnalysis.level,
        metadata: body.metadata || {},
        transaction_amount: body.transaction_amount,
        currency: body.currency,
        session_id: body.session_id,
      };

      for (const rule of rules) {
        const evalStart = performance.now();

        try {
          const evaluation = await RuleEvaluator.evaluate(
            rule,
            evaluationContext,
            { timeout: 100, debug: true }
          );

          const evalResult: RuleEvaluationResult = {
            rule_id: rule.id,
            rule_name: rule.name || `Rule ${rule.id}`,
            description: rule.description,
            condition: rule.condition || rule.logic,
            triggered: evaluation.triggered,
            action: rule.action || 'hold',
            priority: rule.priority || 0,
            evaluation_time_ms: performance.now() - evalStart,
            confidence_score: evaluation.confidence,
            reason: evaluation.reason,
            error: evaluation.error,
            metadata: rule.metadata
          };

          ruleEvaluations.push(evalResult);

          if (evaluation.triggered) {
            debug_info.rules_triggered++;
          }
        } catch (error) {
          const evalResult: RuleEvaluationResult = {
            rule_id: rule.id,
            rule_name: rule.name || `Rule ${rule.id}`,
            description: rule.description,
            condition: rule.condition || rule.logic,
            triggered: false,
            action: rule.action || 'hold',
            priority: rule.priority || 0,
            evaluation_time_ms: performance.now() - evalStart,
            error: error instanceof Error ? error.message : 'Evaluation failed'
          };

          ruleEvaluations.push(evalResult);
          debug_info.errors.push({
            field: `rule_${rule.id}`,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      metrics.rule_eval_end = performance.now();

      // Determine final decision based on rules
      const triggeredRules = ruleEvaluations.filter(r => r.triggered);
      const blockedRule = triggeredRules.find(r => r.action === 'block');
      const holdRule = triggeredRules.find(r => r.action === 'hold');
      const approveRule = triggeredRules.find(r => r.action === 'approve');

      let finalAction: 'approve' | 'hold' | 'block' | 'review';
      let finalReasons: string[] = [];

      if (blockedRule) {
        finalAction = 'block';
        finalReasons.push(`Blocked by rule: ${blockedRule.rule_name}`);
      } else if (holdRule) {
        finalAction = 'hold';
        finalReasons.push(`Held by rule: ${holdRule.rule_name}`);
      } else if (approveRule) {
        finalAction = 'approve';
        finalReasons.push(`Approved by rule: ${approveRule.rule_name}`);
      } else if (riskAnalysis.score >= 70) {
        finalAction = 'review';
        finalReasons.push('High risk score requires manual review');
      } else if (riskAnalysis.score >= 40) {
        finalAction = 'hold';
        finalReasons.push('Medium risk score');
      } else {
        finalAction = 'approve';
        finalReasons.push('Low risk score');
      }

      // Add risk factors to reasons
      finalReasons.push(...riskAnalysis.factors);

      // Calculate final confidence
      const avgConfidence = ruleEvaluations.length > 0
        ? ruleEvaluations.reduce((sum, r) => sum + (r.confidence_score || 0), 0) / ruleEvaluations.length
        : 50;

      // Generate recommended actions
      const recommendedActions: string[] = [];
      if (results.email?.disposable) {
        recommendedActions.push('Request alternative email address');
      }
      if (results.phone?.reachable === false) {
        recommendedActions.push('Verify phone number via SMS');
      }
      if (results.address?.deliverable === false) {
        recommendedActions.push('Verify shipping address');
      }
      if (riskAnalysis.score > 50) {
        recommendedActions.push('Request additional verification');
      }

      const endTime = performance.now();

      // Construct comprehensive response
      const response: TestRulesResponse = {
        results: {
          ...results,
          // Add processing times to each result
          ...(results.email && {
            email: {
              ...results.email,
              processing_time_ms: results.email.processing_time_ms || 0
            }
          }),
          ...(results.phone && {
            phone: {
              ...results.phone,
              processing_time_ms: results.phone.processing_time_ms || 0
            }
          }),
          ...(results.address && {
            address: {
              ...results.address,
              processing_time_ms: results.address.processing_time_ms || 0
            }
          }),
          ...(results.name && {
            name: {
              ...results.name,
              processing_time_ms: results.name.processing_time_ms || 0
            }
          }),
        },
        rule_evaluations: ruleEvaluations,
        final_decision: {
          action: finalAction,
          confidence: avgConfidence,
          reasons: finalReasons,
          risk_score: riskAnalysis.score,
          risk_level: riskAnalysis.level,
          recommended_actions: recommendedActions.length > 0 ? recommendedActions : undefined
        },
        performance_metrics: {
          total_duration_ms: endTime - startTime,
          validation_duration_ms: metrics.validation_end - metrics.validation_start,
          rule_evaluation_duration_ms: metrics.rule_eval_end - metrics.rule_eval_start,
          parallel_validations: true,
          cache_hits: metrics.cache_hits,
          cache_misses: metrics.cache_misses
        },
        request_id,
        timestamp: new Date().toISOString(),
        project_id,
        environment: 'test',
        debug_info: request.headers['x-debug'] === 'true' ? debug_info : undefined
      };

      // Log metrics for monitoring
      request.log.info({
        request_id,
        project_id,
        total_duration_ms: response.performance_metrics.total_duration_ms,
        risk_score: response.final_decision.risk_score,
        final_action: response.final_decision.action,
        rules_triggered: debug_info.rules_triggered,
        cache_hit_rate: metrics.cache_hits / (metrics.cache_hits + metrics.cache_misses)
      }, 'Rules test completed');

      return reply.send(response);

    } catch (error) {
      request.log.error({ error, request_id }, 'Rules test failed');

      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'Internal server error',
        request_id
      });
    }
  });

  // Register custom rules route
  app.post(MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, {
    schema: {
      summary: 'Register Custom Rules',
      description: 'Registers custom business rules for the project.',
      tags: ['Rules'],
      headers: securityHeader,
      security: MGMT_V1_SECURITY,
      body: {
        type: 'object',
        properties: {
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                logic: { type: 'string' },
                severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                enabled: { type: 'boolean' },
              },
            },
          },
        },
      },
      response: {
        200: {
          description: 'Rules registered successfully',
          type: 'object',
          properties: {
            message: { type: 'string' },
            registered_rules: { type: 'array', items: { type: 'string' } },
            request_id: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest, rep: FastifyReply) => {
    try {
      const project_id = (request as any).project_id;
      const { rules } = request.body as { rules: any[] };
      const request_id = generateRequestId();

      // Store rules in database (per project)
      const newRules = rules.map((rule: any) => ({
        name: rule.name,
        description: rule.description,
        logic: rule.logic,
        severity: rule.severity,
        enabled: rule.enabled,
      }));

      const query = 'INSERT INTO rules (project_id, name, description, logic, severity, enabled) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id';
      const insertedRules: any[] = [];
      for (const rule of newRules) {
        const result = await pool.query(query, [project_id, rule.name, rule.description, rule.logic, rule.severity, rule.enabled]);
        insertedRules.push({ ...rule, id: result.rows[0].id });
      }

      console.warn(`Rules registered for project ${project_id}:`, newRules);

      const response: any = {
        message: 'Rules registered successfully',
        registered_rules: insertedRules.map(r => r.id),
        request_id,
      };

      return rep.send(response);
    } catch (error) {
      return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, generateRequestId());
    }
  });
}