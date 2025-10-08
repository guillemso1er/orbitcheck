import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import { REASON_CODES } from "../constants.js";
import { generateRequestId, securityHeader, sendServerError } from "./utils.js";
import { MGMT_V1_ROUTES } from "@orbicheck/contracts";

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
    [REASON_CODES.TAXID_INVALID_FORMAT]: { description: 'Invalid tax ID format', category: 'taxid', severity: 'low' },
    [REASON_CODES.TAXID_INVALID_CHECKSUM]: { description: 'Invalid tax ID checksum', category: 'taxid', severity: 'medium' },
    [REASON_CODES.TAXID_VIES_INVALID]: { description: 'VAT number invalid per VIES', category: 'taxid', severity: 'high' },
    [REASON_CODES.TAXID_VIES_UNAVAILABLE]: { description: 'VIES service unavailable', category: 'taxid', severity: 'medium' },
    [REASON_CODES.ORDER_CUSTOMER_DEDUPE_MATCH]: { description: 'Potential duplicate customer detected', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_ADDRESS_DEDUPE_MATCH]: { description: 'Potential duplicate address detected', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_PO_BOX_BLOCK]: { description: 'Order blocked due to P.O. Box', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_ADDRESS_MISMATCH]: { description: 'Address validation mismatch', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_INVALID_EMAIL]: { description: 'Invalid email in order', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_INVALID_PHONE]: { description: 'Invalid phone in order', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_DUPLICATE_DETECTED]: { description: 'Duplicate order detected', category: 'order', severity: 'high' },
    [REASON_CODES.ORDER_COD_RISK]: { description: 'Increased risk due to COD payment', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_HIGH_VALUE]: { description: 'High value order flagged', category: 'order', severity: 'low' },
    [REASON_CODES.ORDER_HOLD_FOR_REVIEW]: { description: 'Order held for manual review', category: 'order', severity: 'medium' },
    [REASON_CODES.ORDER_SERVER_ERROR]: { description: 'Server error during order evaluation', category: 'order', severity: 'high' },
    [REASON_CODES.DEDUP_SERVER_ERROR]: { description: 'Server error during deduplication', category: 'dedupe', severity: 'high' },
  };
  const desc = descriptions[code];
  return { code, description: desc ? desc.description : 'Unknown reason code', category: desc ? desc.category : 'unknown', severity: desc ? desc.severity : 'medium' };
});

export function registerRulesRoutes(app: FastifyInstance, _pool: Pool): void {
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

  // Placeholder for register rules route (to be implemented)
  app.post(MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, {
    schema: {
      summary: 'Register Custom Rules',
      description: 'Registers custom business rules for the project.',
      tags: ['Rules'],
      headers: securityHeader,
      body: {
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
                reason_code: { type: 'string' },
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

      // For now, log the registration; in production, store in DB
      console.warn(`Rules registered for project ${project_id}:`, rules);

      const response: any = {
        message: 'Rules registered successfully',
        registered_rules: rules.map((r: any) => r.id),
        request_id,
      };

      return rep.send(response);
    } catch (error) {
      return sendServerError(request, rep, error, MGMT_V1_ROUTES.RULES.REGISTER_CUSTOM_RULES, generateRequestId());
    }
  });
}