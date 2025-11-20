import Redis from 'ioredis';
import { Pool } from 'pg';
import { environment } from '../../environment.js';
import { detectPoBox, normalizeAddress, validateAddress } from '../address.js';

// Mock dependencies
jest.mock('node:child_process');


describe('Address Validators', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = new Pool() as any;
    mockPool.query = jest.fn();
    mockRedis = new Redis() as any;
    mockRedis.get = jest.fn();
    mockRedis.set = jest.fn();

    // Default environment mocks
    (environment as any).RADAR_KEY = 'test-radar-key';
    (environment as any).RADAR_API_URL = 'https://api.radar.io/v1';
    (environment as any).NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
  });

  describe('detectPoBox', () => {
    it('should detect PO Box', () => {
      expect(detectPoBox('PO Box 123')).toBe(true);
      expect(detectPoBox('123 Main St')).toBe(false);
    });
  });

  describe('normalizeAddress', () => {
    it('should use Radar for normalization', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          address: {
            number: '123',
            street: 'Main St',
            city: 'New York',
            stateCode: 'NY',
            postalCode: '10001',
            countryCode: 'US'
          }
        })
      });

      const addr = {
        line1: '123 Main Street',
        city: 'New York',
        postal_code: '10001',
        country: 'US',
      };

      const result = await normalizeAddress(addr);

      expect(result.line1).toBe('123 Main St');
      expect(result.city).toBe('New York');
      expect(result.state).toBe('NY');
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('radar.io'), expect.anything());
    });

    it('should fallback to simple trimming if Radar fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });

      const addr = {
        line1: '  123 Main St  ',
        city: ' New York ',
        postal_code: '10001',
        country: 'US',
      };

      const result = await normalizeAddress(addr);

      expect(result.line1).toBe('123 Main St');
      expect(result.city).toBe('New York');
    });
  });

  describe('validateAddress', () => {
    const validAddr = {
      line1: '123 Main St',
      city: 'New York',
      state: 'NY',
      postal_code: '10001',
      country: 'US',
    };

    it('should use Radar as primary validator', async () => {
      // Mock Normalization (Radar call 1)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          address: {
            number: '123',
            street: 'Main St',
            city: 'New York',
            stateCode: 'NY',
            postalCode: '10001',
            countryCode: 'US'
          }
        })
      });

      // Mock Radar Validation (Radar call 2 - inside validateAddress)
      // Note: Since we call normalizeAddress inside validateAddress, it will trigger a fetch.
      // Then validateAddress calls Radar again.
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          meta: { code: 200 },
          address: {
            latitude: 40.7128,
            longitude: -74.0060,
            confidence: 'exact',
          },
          result: { verificationStatus: 'verified' }
        })
      });

      // Mock DB Bounds Check
      (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ 1: 1 }] });

      const result = await validateAddress(validAddr, mockPool, mockRedis);

      expect(result.valid).toBe(true);
      expect(result.geo?.source).toBe('radar');
    });
  });
});