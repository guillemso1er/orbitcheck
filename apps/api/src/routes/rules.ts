import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Pool } from "pg";
import crypto from "crypto";

interface ReasonCode {
  code: string;
  description: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
}

const reasonCodes: ReasonCode[] = [
  // Email validation
  { code: 'email.invalid_format', description: 'Invalid email format', category: 'email', severity: 'low' },
  { code: 'email.mx_not_found', description: 'No MX records found for domain', category: 'email', severity: 'medium' },
  { code: 'email.disposable_domain', description: 'Disposable email domain detected', category: 'email', severity: 'high' },
  { code: 'email.server_error', description: 'Server error during validation', category: 'email', severity: 'high' },

  // Phone validation
  { code: 'phone.invalid_format', description: 'Invalid phone number format', category: 'phone', severity: 'low' },
  { code: 'phone.unparseable', description: 'Phone number could not be parsed', category: 'phone', severity: 'medium' },
  { code: 'phone.otp_sent', description: 'OTP sent successfully', category: 'phone', severity: 'low' },
  { code: 'phone.otp_send_failed', description: 'Failed to send OTP', category: 'phone', severity: 'high' },

  // Address validation
  { code: 'address.po_box', description: 'P.O. Box detected', category: 'address', severity: 'high' },
  { code: 'address.postal_city_mismatch', description: 'Postal code does not match city', category: 'address', severity: 'medium' },

  // Tax ID validation
  { code: 'taxid.invalid_format', description: 'Invalid tax ID format', category: 'taxid', severity: 'low' },
  { code: 'taxid.invalid_checksum', description: 'Invalid tax ID checksum', category: 'taxid', severity: 'medium' },
  { code: 'taxid.vies_invalid', description: 'VAT number invalid per VIES', category: 'taxid', severity: 'high' },
  { code: 'taxid.vies_unavailable', description: 'VIES service unavailable', category: 'taxid', severity: 'medium' },

  // Order evaluation
  { code: 'order.customer_dedupe_match', description: 'Potential duplicate customer detected', category: 'order', severity: 'medium' },
  { code: 'order.address_dedupe_match', description: 'Potential duplicate address detected', category: 'order', severity: 'medium' },
  { code: 'order.po_box_block', description: 'Order blocked due to P.O. Box', category: 'order', severity: 'high' },
  { code: 'order.address_mismatch', description: 'Address validation mismatch', category: 'order', severity: 'medium' },
  { code: 'order.invalid_email', description: 'Invalid email in order', category: 'order', severity: 'medium' },
  { code: 'order.invalid_phone', description: 'Invalid phone in order', category: 'order', severity: 'medium' },
  { code: 'order.duplicate_detected', description: 'Duplicate order detected', category: 'order', severity: 'high' },
  { code: 'order.cod_risk', description: 'Increased risk due to COD payment', category: 'order', severity: 'medium' },
  { code: 'order.high_value', description: 'High value order flagged', category: 'order', severity: 'low' },
  { code: 'order.hold_for_review', description: 'Order held for manual review', category: 'order', severity: 'medium' },
  { code: 'order.server_error', description: 'Server error during order evaluation', category: 'order', severity: 'high' },

  // Deduplication
  { code: 'dedupe.server_error', description: 'Server error during deduplication', category: 'dedupe', severity: 'high' },
];

export async function registerRulesRoutes(app: FastifyInstance, pool: Pool) {
  // Reason code catalog endpoint
  app.get('/v1/rules/catalog', {
    schema: {
      summary: 'Get Reason Code Catalog',
      description: 'Returns a comprehensive list of all possible reason codes with descriptions and severity levels.',
      tags: ['Rules'],
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
  }, async (req: FastifyRequest, rep: FastifyReply) => {
    const request_id = crypto.randomUUID();
    const response = {
      reason_codes: reasonCodes,
      request_id,
    };
    return rep.send(response);
  });

  // Placeholder for register rules route (to be implemented)
  app.post('/v1/rules/register', {
    schema: {
      summary: 'Register Custom Rules',
      description: 'Registers custom business rules for the project.',
      tags: ['Rules'],
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
  }, async (req: FastifyRequest, rep: FastifyReply) => {
    const project_id = (req as any).project_id;
    const { rules } = req.body as { rules: any[] };
    const request_id = crypto.randomUUID();

    // For now, log the registration; in production, store in DB
    console.log(`Rules registered for project ${project_id}:`, rules);

    const response = {
      message: 'Rules registered successfully',
      registered_rules: rules.map((r: any) => r.id),
      request_id,
    };

    return rep.send(response);
  });
}