#!/usr/bin/env node

/**
 * Script to generate OpenAPI specification from existing API routes
 * This helps maintain consistency between the actual API and the OpenAPI spec
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read existing routes and extract schemas
const routesPath = path.join(__dirname, '../../apps/api/src/routes');
const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'OrbiCheck API',
    description: 'API for validation, deduplication, and risk assessment services',
    version: '1.0.0',
    contact: {
      name: 'OrbiCheck API Team',
      email: 'api@orbicheck.com'
    }
  },
  servers: [
    {
      url: 'http://localhost:8080',
      description: 'Development server'
    }
  ],
  paths: {},
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' }
            }
          },
          request_id: { type: 'string' }
        }
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prefix: { type: 'string' },
          status: { type: 'string', enum: ['active', 'revoked'] },
          created_at: { type: 'string', format: 'date-time' },
          last_used_at: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      Customer: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' }
        }
      },
      Address: {
        type: 'object',
        properties: {
          line1: { type: 'string' },
          line2: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postal_code: { type: 'string' },
          country: { type: 'string', minLength: 2, maxLength: 2 }
        },
        required: ['line1', 'city', 'postal_code', 'country']
      },
      Order: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          customer: { $ref: '#/components/schemas/Customer' },
          shipping_address: { $ref: '#/components/schemas/Address' },
          total_amount: { type: 'number' },
          currency: { type: 'string', pattern: '^[A-Z]{3}$' },
          payment_method: { type: 'string', enum: ['card', 'cod', 'bank_transfer'] }
        },
        required: ['order_id', 'customer', 'shipping_address', 'total_amount', 'currency']
      }
    },
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  }
};

// Helper function to convert Fastify schema to OpenAPI schema
function convertSchema(fastifySchema) {
  if (!fastifySchema) return {};
  
  const result = {};
  
  if (fastifySchema.body) {
    result.requestBody = {
      content: {
        'application/json': {
          schema: fastifySchema.body
        }
      }
    };
  }
  
  if (fastifySchema.params) {
    result.parameters = Object.entries(fastifySchema.params.properties).map(([name, schema]) => ({
      name,
      in: 'path',
      required: fastifySchema.params.required?.includes(name),
      schema
    }));
  }
  
  if (fastifySchema.querystring) {
    result.parameters = [
      ...(result.parameters || []),
      ...Object.entries(fastifySchema.querystring.properties).map(([name, schema]) => ({
        name,
        in: 'query',
        required: fastifySchema.querystring.required?.includes(name),
        schema
      }))
    ];
  }
  
  if (fastifySchema.response) {
    result.responses = {};
    Object.entries(fastifySchema.response).forEach(([statusCode, response]) => {
      result.responses[statusCode] = {
        description: response.description || 'Success',
        content: {
          'application/json': {
            schema: response
          }
        }
      };
    });
  }
  
  if (fastifySchema.headers) {
    result.security = [{ BearerAuth: [] }];
  }
  
  return result;
}

// Read route files and extract OpenAPI paths
const routeFiles = fs.readdirSync(routesPath).filter(file => file.endsWith('.ts'));

routeFiles.forEach(file => {
  const routePath = path.join(routesPath, file);
  const routeName = path.basename(file, '.ts');
  
  try {
    // This is a simplified approach - in a real scenario, you'd want to
    // parse the actual route definitions and extract schemas programmatically
    console.log(`Processing route: ${routeName}`);
    
    // Add basic path definitions based on route names
    switch (routeName) {
      case 'auth':
        openapiSpec.paths['/auth/register'] = {
          post: {
            summary: 'Register User',
            tags: ['Authentication'],
            ...convertSchema({
              body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 }
                }
              },
              response: {
                '201': {
                  description: 'User registered successfully',
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' }
                      }
                    },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        
        openapiSpec.paths['/auth/login'] = {
          post: {
            summary: 'Login User',
            tags: ['Authentication'],
            ...convertSchema({
              body: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' }
                }
              },
              response: {
                '200': {
                  description: 'User logged in successfully',
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' }
                      }
                    },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        break;
        
      case 'api-keys':
        openapiSpec.paths['/api-keys'] = {
          get: {
            summary: 'List API Keys',
            tags: ['API Keys'],
            ...convertSchema({
              response: {
                '200': {
                  description: 'List of API keys',
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ApiKey' }
                    },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          },
          post: {
            summary: 'Create API Key',
            tags: ['API Keys'],
            ...convertSchema({
              body: {
                type: 'object',
                properties: {
                  name: { type: 'string' }
                }
              },
              response: {
                '201': {
                  description: 'API key created',
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    prefix: { type: 'string' },
                    full_key: { type: 'string' },
                    status: { type: 'string' },
                    created_at: { type: 'string', format: 'date-time' },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        
        openapiSpec.paths['/api-keys/{id}'] = {
          delete: {
            summary: 'Revoke API Key',
            tags: ['API Keys'],
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            ...convertSchema({
              response: {
                '200': {
                  description: 'API key revoked',
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    status: { type: 'string' },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        break;
        
      case 'data':
        openapiSpec.paths['/v1/logs'] = {
          get: {
            summary: 'Get Event Logs',
            tags: ['Data Retrieval'],
            ...convertSchema({
              querystring: {
                type: 'object',
                properties: {
                  reason_code: { type: 'string' },
                  endpoint: { type: 'string' },
                  status: { type: 'integer' },
                  limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
                  offset: { type: 'integer', minimum: 0, default: 0 }
                }
              },
              response: {
                '200': {
                  description: 'List of log entries',
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          type: { type: 'string' },
                          endpoint: { type: 'string' },
                          reason_codes: { type: 'array', items: { type: 'string' } },
                          status: { type: 'integer' },
                          meta: { type: 'object' },
                          created_at: { type: 'string', format: 'date-time' }
                        }
                      }
                    },
                    next_cursor: { type: 'string', nullable: true },
                    total_count: { type: 'integer' },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        
        openapiSpec.paths['/v1/usage'] = {
          get: {
            summary: 'Get Usage Statistics',
            tags: ['Data Retrieval'],
            ...convertSchema({
              response: {
                '200': {
                  description: 'Usage statistics',
                  type: 'object',
                  properties: {
                    period: { type: 'string' },
                    totals: {
                      type: 'object',
                      properties: {
                        validations: { type: 'integer' },
                        orders: { type: 'integer' }
                      }
                    },
                    by_day: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', format: 'date' },
                          validations: { type: 'integer' },
                          orders: { type: 'integer' }
                        }
                      }
                    },
                    top_reason_codes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          code: { type: 'string' },
                          count: { type: 'integer' }
                        }
                      }
                    },
                    cache_hit_ratio: { type: 'number' },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        break;
        
      case 'orders':
        openapiSpec.paths['/v1/orders/evaluate'] = {
          post: {
            summary: 'Evaluate Order',
            tags: ['Order Evaluation'],
            ...convertSchema({
              body: { $ref: '#/components/schemas/Order' },
              response: {
                '200': {
                  description: 'Order evaluation results',
                  type: 'object',
                  properties: {
                    order_id: { type: 'string' },
                    risk_score: { type: 'number', minimum: 0, maximum: 100 },
                    action: { type: 'string', enum: ['approve', 'hold', 'block'] },
                    tags: { type: 'array', items: { type: 'string' } },
                    reason_codes: { type: 'array', items: { type: 'string' } },
                    customer_dedupe: {
                      type: 'object',
                      properties: {
                        matches: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              similarity_score: { type: 'number' },
                              match_type: { type: 'string' },
                              data: { type: 'object' }
                            }
                          }
                        },
                        suggested_action: { type: 'string' },
                        canonical_id: { type: 'string', nullable: true }
                      }
                    },
                    address_dedupe: {
                      type: 'object',
                      properties: {
                        matches: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string' },
                              similarity_score: { type: 'number' },
                              match_type: { type: 'string' },
                              data: { type: 'object' }
                            }
                          }
                        },
                        suggested_action: { type: 'string' },
                        canonical_id: { type: 'string', nullable: true }
                      }
                    },
                    validations: {
                      type: 'object',
                      properties: {
                        email: {
                          type: 'object',
                          properties: {
                            valid: { type: 'boolean' },
                            reason_codes: { type: 'array', items: { type: 'string' } },
                            disposable: { type: 'boolean' }
                          }
                        },
                        phone: {
                          type: 'object',
                          properties: {
                            valid: { type: 'boolean' },
                            reason_codes: { type: 'array', items: { type: 'string' } },
                            country: { type: 'string', nullable: true }
                          }
                        },
                        address: {
                          type: 'object',
                          properties: {
                            valid: { type: 'boolean' },
                            reason_codes: { type: 'array', items: { type: 'string' } },
                            po_box: { type: 'boolean' },
                            postal_city_match: { type: 'boolean' },
                            in_bounds: { type: 'boolean' }
                          }
                        }
                      }
                    },
                    request_id: { type: 'string' }
                  }
                }
              }
            })
          }
        };
        break;
    }
  } catch (error) {
    console.error(`Error processing route ${file}:`, error);
  }
});

// Write the OpenAPI specification
const outputPath = path.join(__dirname, 'openapi.yaml');
fs.writeFileSync(outputPath, JSON.stringify(openapiSpec, null, 2));

console.log(`OpenAPI specification generated at: ${outputPath}`);
console.log(`Total paths defined: ${Object.keys(openapiSpec.paths).length}`);