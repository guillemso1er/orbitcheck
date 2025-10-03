import type { ChildProcess } from 'node:child_process';
import * as cpModule from 'node:child_process';

import { detectPoBox, normalizeAddress } from '../address';

// Mock the entire 'node:child_process' module
jest.mock('node:child_process');

// Create a typed constant for the mocked function
const mockedExecFile = cpModule.execFile as jest.MockedFunction<typeof cpModule.execFile>;

describe('Address Validators', () => {
  describe('detectPoBox', () => {
    it('should detect PO Box in English', () => {
      expect(detectPoBox('PO Box 123')).toBe(true);
      expect(detectPoBox('P.O. Box 123')).toBe(true);
    });

    it('should detect PO Box in Spanish', () => {
      expect(detectPoBox('Apartado Postal 123')).toBe(true);
      expect(detectPoBox('Apartado 123')).toBe(true);
    });

    it('should detect PO Box in Portuguese', () => {
      expect(detectPoBox('Caixa Postal 123')).toBe(true);
    });

    it('should detect PO Box in other languages', () => {
      expect(detectPoBox('Casilla 123')).toBe(true);
      expect(detectPoBox('Cas. B 123')).toBe(true);
    });

    it('should not detect non-PO Box', () => {
      expect(detectPoBox('123 Main St')).toBe(false);
      expect(detectPoBox('Apt 4B')).toBe(false);
    });
  });

  describe('normalizeAddress', () => {
    beforeEach(() => {
      // Clear any previous mock implementations and calls
      mockedExecFile.mockClear();
    });

    it('should normalize a basic address using libpostal', async () => {
      const mockStdout = `house_number: 123
road: Main St
city: New York
state: NY
postcode: 10001
country: US`;

      // Provide an implementation for the mocked execFile function
      mockedExecFile.mockImplementation(((...arguments_: any[]): ChildProcess => {
        const callback = arguments_.pop();

        // FIX: Call the callback with a single object argument to match
        // how promisify(execFile) resolves.
        callback(null, { stdout: mockStdout, stderr: '' });

        return {} as ChildProcess;
      }) as any);

      const addr = {
        line1: '123 Main Street',
        city: 'New York',
        postal_code: '10001',
        country: 'US',
      };

      const result = await normalizeAddress(addr);

      expect(mockedExecFile).toHaveBeenCalledWith('/usr/local/bin/parse-address', expect.any(Array), expect.any(Function));
      expect(result.line1).toBe('123 Main St');
      expect(result.city).toBe('New York');
      expect(result.postal_code).toBe('10001');
      expect(result.country).toBe('US');
      expect(result.state).toBe('NY');
    });

    it('should handle fallback normalization when libpostal fails', async () => {
      mockedExecFile.mockImplementation(((...arguments_: any[]): ChildProcess => {
        const callback = arguments_.pop();
        callback(new Error('Mock libpostal error'), '', ''); // Simulate failure
        return {} as ChildProcess;
      }) as any);

      const addr = {
        line1: '123 Main St',
        line2: 'Apt 4B',
        city: 'NYC',
        state: 'NY',
        postal_code: '10001',
        country: 'us',
      };

      const result = await normalizeAddress(addr);

      expect(result.line1).toBe('123 Main St');
      expect(result.line2).toBe('Apt 4B');
      expect(result.city).toBe('NYC');
      expect(result.state).toBe('NY');
      expect(result.postal_code).toBe('10001');
      expect(result.country).toBe('US');
    });

    it('should handle missing fields gracefully', async () => {
      mockedExecFile.mockImplementation(((...arguments_: any[]): ChildProcess => {
        const callback = arguments_.pop();
        callback(new Error('Mock error'), '', ''); // Simulate failure
        return {} as ChildProcess;
      }) as any);

      const addr = {
        line1: '123 Main St',
        city: 'NYC',
        postal_code: '10001',
        country: 'us',
      };

      const result = await normalizeAddress(addr);

      expect(result.line2).toBe('');
      expect(result.state).toBe('');
    });
  });
});