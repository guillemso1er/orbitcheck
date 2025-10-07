import soap from 'soap';

import {
  validateCNPJ,
  validateCPF,
  validateCUIT,
  validateEIN,
  validateES,
  validateNIT,
  validateRFC,
  validateRUC,
  validateRUT,
  validateTaxId,
} from '../taxid.js';

jest.mock('soap', () => ({
  createClientAsync: jest.fn(),
}));

describe('Tax ID Validators', () => {
  describe('validateCPF', () => {
    it('should validate a valid CPF', () => {
      const result = validateCPF('123.456.789-09');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate an invalid CPF format', () => {
      const result = validateCPF('123');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate all identical digits', () => {
      const result = validateCPF('111.111.111-11');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateCPF('123.456.789-00');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateCNPJ', () => {
    it('should validate a valid CNPJ', () => {
      const result = validateCNPJ('11.222.333/0001-81');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid format', () => {
      const result = validateCNPJ('123');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate all identical digits', () => {
      const result = validateCNPJ('11.111.111/1111-11');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateCNPJ('11.222.333/0001-00');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateRFC', () => {
    it('should validate a valid RFC (person)', () => {
      const result = validateRFC('ABCD901231AB7');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should validate a valid RFC (entity)', () => {
      const result = validateRFC('ABC901231004');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid format', () => {
      const result = validateRFC('123');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateRFC('ABCD901231AB8');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateCUIT', () => {
    it('should validate a valid CUIT', () => {
      const result = validateCUIT('20-27563065-9');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid format', () => {
      const result = validateCUIT('123');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateCUIT('20-27563065-0');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateRUT', () => {
    it('should validate a valid RUT', () => {
      const result = validateRUT('76.765.943-1');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should validate with K digit', () => {
      const result = validateRUT('76.765.944-K');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid format', () => {
      const result = validateRUT('ABC');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateRUT('76.765.943-0');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateRUC', () => {
    it('should validate a valid RUC', () => {
      const result = validateRUC('20512345671');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid format', () => {
      const result = validateRUC('123');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateRUC('20512345670');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateNIT', () => {
    it('should validate a valid NIT', () => {
      const result = validateNIT('900123456-8');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid checksum', () => {
      const result = validateNIT('900123456-0');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateES', () => {
    it('should validate a valid NIF', () => {
      const result = validateES('12345678Z');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should validate a valid NIE', () => {
      const result = validateES('X1234567L');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should validate a valid CIF (simplified)', () => {
      const result = validateES('A12345678');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid format', () => {
      const result = validateES('123');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });

    it('should invalidate invalid checksum', () => {
      const result = validateES('12345678A');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_checksum');
    });
  });

  describe('validateEIN', () => {
    it('should validate a valid EIN', () => {
      const result = validateEIN('12-3456789');
      expect(result.valid).toBe(true);
      expect(result.reason_codes).toEqual([]);
    });

    it('should invalidate invalid length', () => {
      const result = validateEIN('12345678');
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });
  });

  describe('validateTaxId', () => {
    beforeEach(() => {
      (soap.createClientAsync as jest.Mock).mockResolvedValue({
        checkVatAsync: jest.fn().mockResolvedValue([{ valid: true }]),
      } as any);
    });

    it('should validate CPF via type', async () => {
      const result = await validateTaxId({ type: 'CPF', value: '123.456.789-09', country: 'BR' }) as { valid: boolean; source: string };
      expect(result.valid).toBe(true);
      expect(result.source).toBe('format');
    });

    it('should handle VAT via VIES', async () => {
      const result = await validateTaxId({ type: 'VAT', value: 'DE123456789', country: 'DE' }) as { source: string; valid: boolean };
      expect(result.source).toBe('vies');
      expect(result.valid).toBe(true);
    });

    it('should invalidate unknown type', async () => {
      const result = await validateTaxId({ type: 'UNKNOWN', value: '123', country: '' }) as { valid: boolean; reason_codes: string[] };
      expect(result.valid).toBe(false);
      expect(result.reason_codes).toContain('taxid.invalid_format');
    });
  });
});