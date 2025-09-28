import Fastify from 'fastify';
import request from 'supertest';

// --- Reusable Mock Instances ---
const mockPool = {
  query: jest.fn(),
  end: jest.fn(),
};

const mockRedisInstance = {
  sismember: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  quit: jest.fn(),
};

const mockTwilioInstance = {
  messages: {
    create: jest.fn(),
  },
};

// --- Module Mocks ---
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

jest.mock('ioredis', () => jest.fn(() => mockRedisInstance));

jest.mock('twilio', () => jest.fn(() => mockTwilioInstance));

jest.mock('node-fetch', () => jest.fn());

jest.mock('node:dns/promises', () => ({
  resolveMx: jest.fn(),
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}));

jest.mock('../validators/taxid', () => ({
  validateTaxId: jest.fn(),
}));

jest.mock('../validators/address', () => ({
  normalizeAddress: jest.fn(),
  detectPoBox: jest.fn(),
}));

jest.mock('@hapi/address', () => ({
  isEmailValid: jest.fn(),
}));

jest.mock('libphonenumber-js', () => ({
  parsePhoneNumber: jest.fn(),
}));

// --- Test Setup ---
let registerRoutes: any;

const createApp = () => {
  const app = Fastify({ logger: false });
  registerRoutes(app, mockPool as any, mockRedisInstance as any);
  return app;
};


describe('Web API Endpoints', () => {
  let app: any;

  // Dynamically imported modules for mocking
  let hapi: any;
  let mockDns: any;
  let libphone: any;
  let mockAddressValidator: any;

  beforeAll(async () => {
    process.env.TWILIO_ACCOUNT_SID = 'test_sid';
    process.env.TWILIO_AUTH_TOKEN = 'test_token';
    process.env.TWILIO_PHONE_NUMBER = '+15551234567';

    const web = await import('../web');
    registerRoutes = web.registerRoutes;

    hapi = require('@hapi/address');
    mockDns = require('node:dns/promises');
    libphone = require('libphonenumber-js');
    mockAddressValidator = require('../validators/address');
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // --- Default Mock Implementations (Success Cases) ---
    mockPool.query.mockImplementation((queryText: string) => {
      // 1. Handle authentication successfully
      if (queryText.startsWith('select id, project_id from api_keys')) {
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
      }
      // 2. Handle successful postal code validation for order tests
      if (queryText.startsWith('select 1 from geonames_postal')) {
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      }
      // 3. For any other query (dedupe, logs, etc.), default to finding nothing
      return Promise.resolve({ rows: [] });
    });

    mockPool.end.mockResolvedValue('OK');
    mockRedisInstance.quit.mockResolvedValue('OK');

    mockRedisInstance.sismember.mockResolvedValue(0);
    mockRedisInstance.incr.mockResolvedValue(1);
    mockRedisInstance.expire.mockResolvedValue(true);
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.set.mockResolvedValue('OK');
    mockTwilioInstance.messages.create.mockResolvedValue({ sid: 'test_sid' });
    hapi.isEmailValid.mockReturnValue(true);
    libphone.parsePhoneNumber.mockReturnValue({
      isValid: () => true,
      number: '+15551234567',
      country: 'US',
    });
    mockDns.resolveMx.mockResolvedValue([{ exchange: 'mx.example.com' }]);
    mockAddressValidator.normalizeAddress.mockResolvedValue({
      line1: '123 Main St',
      city: 'New York',
      postal_code: '10001',
      country: 'US',
    });
    mockAddressValidator.detectPoBox.mockReturnValue(false);

    app = createApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /validate/email', () => {
    it('should validate a valid email using default success mocks', async () => {
      const res = await request(app.server)
        .post('/validate/email')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.disposable).toBe(false);
      expect(res.body.mx_found).toBe(true);
    });

    it('should reject disposable email when Redis finds a match', async () => {
      // Override: Simulate the domain being in the disposable set in Redis
      mockRedisInstance.sismember.mockImplementation((setName, domain) =>
        Promise.resolve(domain === 'disposable.com' ? 1 : 0)
      );

      const res = await request(app.server)
        .post('/validate/email')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'test@disposable.com' })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.disposable).toBe(true);
      expect(res.body.reason_codes).toContain('email.disposable_domain');
    });

    it('should handle invalid format when validator returns false', async () => {
      // Override: Simulate an invalid email format
      hapi.isEmailValid.mockReturnValue(false);

      const res = await request(app.server)
        .post('/validate/email')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'invalid-email' })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason_codes).toContain('email.invalid_format');
    });
  });

  describe('POST /validate/phone', () => {
    it('should validate a valid phone number', async () => {
      const res = await request(app.server)
        .post('/validate/phone')
        .set('Authorization', 'Bearer valid_key')
        .send({ phone: '+1 555 123 4567' })
        .expect(200);

      expect(res.body.valid).toBe(true);
      expect(res.body.e164).toBe('+15551234567');
    });

    it('should handle invalid phone number when parser returns null', async () => {
      // Override: Simulate an invalid phone number
      libphone.parsePhoneNumber.mockReturnValue(null);

      const res = await request(app.server)
        .post('/validate/phone')
        .set('Authorization', 'Bearer valid_key')
        .send({ phone: 'invalid' })
        .expect(200);

      expect(res.body.valid).toBe(false);
      expect(res.body.reason_codes).toContain('phone.invalid_format');
    });

    it('should send OTP if requested', async () => {
      const res = await request(app.server)
        .post('/validate/phone')
        .set('Authorization', 'Bearer valid_key')
        .send({ phone: '+1 555 123 4567', request_otp: true })
        .expect(200);

      expect(res.body.verification_id).toBeDefined();
      expect(mockTwilioInstance.messages.create).toHaveBeenCalled();
    });
  });

  describe('POST /dedupe/customer', () => {
    it('should find exact email match', async () => {
      // Override: Mock the DB query for finding a customer by email
      mockPool.query.mockImplementation((queryText: string) => {
        if (queryText.includes('FROM customers WHERE project_id = $2 AND email = $1')) {
          return Promise.resolve({
            rows: [{ id: 'uuid-1', email: 'test@example.com', first_name: 'John', last_name: 'Doe', similarity: 1.0 }]
          });
        }
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] }); // Auth
      });

      const res = await request(app.server)
        .post('/dedupe/customer')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'test@example.com', first_name: 'John', last_name: 'Doe' })
        .expect(200);

      expect(res.body.matches.length).toBe(1);
      expect(res.body.suggested_action).toBe('merge_with');
    });

    it('should suggest review for fuzzy name match', async () => {
      // Override: Mock the DB query to return a fuzzy name match
      mockPool.query.mockImplementation((queryText: string) => {
        if (queryText.includes("similarity((first_name || ' ' || last_name), $1) > 0.3")) {
          return Promise.resolve({
            rows: [{ id: 'uuid-2', first_name: 'Jon', last_name: 'Doe', name_score: 0.85, email_score: 0, phone_score: 0 }]
          });
        }
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] }); // Auth
      });

      const res = await request(app.server)
        .post('/dedupe/customer')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'new@example.com', first_name: 'John', last_name: 'Doe' })
        .expect(200);

      expect(res.body.suggested_action).toBe('review');
    });

    it('should create new if no matches are found', async () => {
      // No override needed, the default mock returns no matches
      const res = await request(app.server)
        .post('/dedupe/customer')
        .set('Authorization', 'Bearer valid_key')
        .send({ email: 'unique@example.com', first_name: 'Jane', last_name: 'Smith' })
        .expect(200);

      expect(res.body.matches.length).toBe(0);
      expect(res.body.suggested_action).toBe('create_new');
    });
  });

  describe('POST /order/evaluate', () => {
    it('should approve low-risk order', async () => {
      // The default mock setup now correctly represents a "perfect" low-risk scenario.
      // No overrides are needed.
      const res = await request(app.server)
        .post('/order/evaluate')
        .set('Authorization', 'Bearer valid_key')
        .send({
          order_id: 'order-123',
          customer: { email: 'test@example.com', first_name: 'John', last_name: 'Doe' },
          shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
          total_amount: 100,
          currency: 'USD',
          payment_method: 'card',
        })
        .expect(200);

      expect(res.body.action).toBe('approve');
      expect(res.body.risk_score).toBe(0);
    });

    it('should hold high-risk order (PO Box)', async () => {
      // Override: Simulate PO Box detection
      mockAddressValidator.detectPoBox.mockReturnValue(true);

      const res = await request(app.server)
        .post('/order/evaluate')
        .set('Authorization', 'Bearer valid_key')
        .send({
          order_id: 'order-po-box',
          customer: { email: 'test@example.com' },
          shipping_address: { line1: 'PO Box 123', city: 'New York', postal_code: '10001', country: 'US' },
          total_amount: 100,
          currency: 'USD',
          payment_method: 'cod',
        })
        .expect(200);

      expect(res.body.action).toBe('hold');
      expect(res.body.risk_score).toBe(50); // 30 (po_box) + 20 (cod)
      expect(res.body.reason_codes).toContain('order.po_box_block');
    });

    it('should hold duplicate order', async () => {
      // Override: Mock DB ONLY to find a duplicate order_id for this specific test
      mockPool.query.mockImplementation((queryText: string) => {
        if (queryText.startsWith('SELECT id FROM orders')) { // Intercept the order dedupe query
          return Promise.resolve({ rows: [{ id: 'existing_order' }] });
        }
        if (queryText.startsWith('select id, project_id from api_keys')) {
          return Promise.resolve({ rows: [{ project_id: 'test_project' }] });
        }
        if (queryText.startsWith('select 1 from geonames_postal')) {
          return Promise.resolve({ rows: [{ '?column?': 1 }] });
        }
        return Promise.resolve({ rows: [] }); // Default for others
      });

      const res = await request(app.server)
        .post('/order/evaluate')
        .set('Authorization', 'Bearer valid_key')
        .send({
          order_id: 'duplicate-123',
          customer: { email: 'test@example.com' },
          shipping_address: { line1: '123 Main St', city: 'New York', postal_code: '10001', country: 'US' },
          total_amount: 100,
          currency: 'USD',
        })
        .expect(200);

      expect(res.body.action).toBe('hold');
      expect(res.body.risk_score).toBe(50); // 50 from duplicate order
      expect(res.body.reason_codes).toContain('order.duplicate_detected');
    });
  });

  describe('GET /logs', () => {
    it('should return logs for the project', async () => {
      const logEntry = { id: 'log-1', type: 'validation', endpoint: '/validate/email', reason_codes: [], status: 200, created_at: new Date().toISOString() };
      // Override: Mock DB to return a log entry
      mockPool.query.mockImplementation((queryText: string) => {
        if (queryText.includes('from logs')) {
          return Promise.resolve({ rows: [logEntry] });
        }
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] }); // Auth
      });

      const res = await request(app.server)
        .get('/logs')
        .set('Authorization', 'Bearer valid_key')
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe('log-1');
    });
  });

  describe('GET /usage', () => {
    it('should return usage stats', async () => {
      const usageData = [
        { date: '2023-01-01', validations: 10, orders: 5 },
        { date: '2023-01-02', validations: 20, orders: 10 },
      ];
      // Override: Mock DB to return usage data
      mockPool.query.mockImplementation((queryText: string) => {
        if (queryText.includes('from usage_daily')) {
          return Promise.resolve({ rows: usageData });
        }
        return Promise.resolve({ rows: [{ project_id: 'test_project' }] }); // Auth
      });

      const res = await request(app.server)
        .get('/usage')
        .set('Authorization', 'Bearer valid_key')
        .expect(200);

      expect(res.body.totals.validations).toBe(30);
      expect(res.body.totals.orders).toBe(15);
      expect(res.body.by_day.length).toBe(2);
    });
  });

  describe('GET /rules', () => {
    it('should return a list of rules', async () => {
      // No DB override needed for this static endpoint
      const res = await request(app.server)
        .get('/rules')
        .set('Authorization', 'Bearer valid_key')
        .expect(200);

      expect(res.body.rules.length).toBeGreaterThan(0);
      expect(res.body.rules[0].id).toBe('email_format');
    });
  });

  describe('Authentication', () => {
    it('should reject requests with a missing API key', async () => {
      // FIX: Expect 400 because a missing required header is a schema/request format error.
      await request(app.server)
        .post('/validate/email')
        .send({ email: 'test@example.com' })
        .expect(400);
    });

    it('should reject requests with an invalid API key', async () => {
      // Override: Mock the auth query to return no matching key
      mockPool.query.mockImplementation((queryText) => {
        if (queryText.startsWith('select id, project_id from api_keys')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] }); // Should not be reached
      });

      const res = await request(app.server)
        .post('/validate/email')
        .set('Authorization', 'Bearer invalid_key')
        .send({ email: 'test@example.com' })
        .expect(401);

      expect(res.body.error.code).toBe('unauthorized');
    });
  });
});
