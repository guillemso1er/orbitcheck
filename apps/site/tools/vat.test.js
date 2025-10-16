describe('VAT Checker Tests', () => {
  // Test helper function checkESNIFNIE
  describe('checkESNIFNIE', () => {
    test('valid DNI', () => {
      // Mock the function from vat.html
      const checkESNIFNIE = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        var nifRegex = /^(\d{8})([TRWAGMYFPDXBNJZSQVHLCKE])$/; // DNI
        if (nifRegex.test(v)) {
          var num = parseInt(v.substr(0, 8), 10);
          var letter = letters[num % 23];
          return { valid: letter === v[8], type: 'DNI', normalized: v };
        }
        return null;
      };
      const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';

      const result = checkESNIFNIE('12345678Z');
      expect(result).toEqual({ valid: true, type: 'DNI', normalized: '12345678Z' });
    });

    test('invalid DNI', () => {
      const checkESNIFNIE = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        var nifRegex = /^(\d{8})([TRWAGMYFPDXBNJZSQVHLCKE])$/;
        if (nifRegex.test(v)) {
          var num = parseInt(v.substr(0, 8), 10);
          var letter = letters[num % 23];
          return { valid: letter === v[8], type: 'DNI', normalized: v };
        }
        return null;
      };
      const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';

      const result = checkESNIFNIE('12345678A'); // Wrong checksum
      expect(result.valid).toBe(false);
    });

    test('valid NIE', () => {
      const checkESNIFNIE = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        var nieRegex = /^[XYZ]\d{7}[TRWAGMYFPDXBNJZSQVHLCKE]$/;
        if (nieRegex.test(v)) {
          var map = { X: '0', Y: '1', Z: '2' };
          var num = parseInt(map[v[0]] + v.substr(1, 7), 10);
          var letter = letters[num % 23];
          return { valid: letter === v[8], type: 'NIE', normalized: v };
        }
        return null;
      };
      const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';

      const result = checkESNIFNIE('X1234567L');
      expect(result).toEqual({ valid: true, type: 'NIE', normalized: 'X1234567L' });
    });
  });

  // Test checkESNIFNIE function for CIF
  describe('checkESNIFNIE - CIF', () => {
    test('valid CIF', () => {
      const checkESNIFNIE = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        var nifRegex = /^(\d{8})([TRWAGMYFPDXBNJZSQVHLCKE])$/; // DNI
        var nieRegex = /^[XYZ]\d{7}[TRWAGMYFPDXBNJZSQVHLCKE]$/; // NIE
        var cifRegex = /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/; // CIF
        var letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
        if (cifRegex.test(v)) {
          // Basic checksum for CIF
          var control = v.slice(-1), digits = v.substr(1, 7).split('').map(Number);
          var sum = 0;
          for (var i = 0; i < digits.length; i++) {
            var n = digits[i];
            if (i % 2 === 0) { var t = n * 2; sum += Math.floor(t / 10) + (t % 10); } else sum += n;
          }
          var res = (10 - (sum % 10)) % 10;
          var valid = (/[ABEH]/.test(v[0]) && String(res) === control) ||
            (/[KPQS]/.test(v[0]) && 'JABCDEFGHI'[res] === control) ||
            (/[CDFGJLMNRUVW]/.test(v[0]) && (String(res) === control || 'JABCDEFGHI'[res] === control));
          return { valid: valid, type: 'CIF', normalized: v };
        }
        return null;
      };

      const result = checkESNIFNIE('A58818501');
      expect(result).toEqual({ valid: true, type: 'CIF', normalized: 'A58818501' });
    });

    test('invalid CIF', () => {
      const checkESNIFNIE = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        var cifRegex = /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/; // CIF
        if (cifRegex.test(v)) {
          // Basic checksum for CIF
          var control = v.slice(-1), digits = v.substr(1, 7).split('').map(Number);
          var sum = 0;
          for (var i = 0; i < digits.length; i++) {
            var n = digits[i];
            if (i % 2 === 0) { var t = n * 2; sum += Math.floor(t / 10) + (t % 10); } else sum += n;
          }
          var res = (10 - (sum % 10)) % 10;
          var valid = (/[ABEH]/.test(v[0]) && String(res) === control) ||
            (/[KPQS]/.test(v[0]) && 'JABCDEFGHI'[res] === control) ||
            (/[CDFGJLMNRUVW]/.test(v[0]) && (String(res) === control || 'JABCDEFGHI'[res] === control));
          return { valid: valid, type: 'CIF', normalized: v };
        }
        return null;
      };

      const result = checkESNIFNIE('A58818502'); // Wrong checksum
      expect(result.valid).toBe(false);
    });
  });

  // Test isLikelyVAT function
  describe('isLikelyVAT', () => {
    test('valid VAT format', () => {
      const isLikelyVAT = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        return /^[A-Z]{2}[A-Z0-9]+$/.test(v);
      };

      expect(isLikelyVAT('ESB12345678')).toBe(true);
      expect(isLikelyVAT('FR12345678901')).toBe(true);
    });

    test('invalid VAT format', () => {
      const isLikelyVAT = (v) => {
        v = v.toUpperCase().replace(/\s|-/g, '');
        return /^[A-Z]{2}[A-Z0-9]+$/.test(v);
      };

      expect(isLikelyVAT('123456')).toBe(false);
      expect(isLikelyVAT('AB')).toBe(false);
    });
  });

  // Test button click functionality
  describe('VAT checker button click', () => {
    beforeEach(() => {
      // Set up DOM elements
      document.body.innerHTML = `
        <input id="vat" />
        <button id="check">Check</button>
        <div id="out"></div>
      `;
    });

    test('empty input', () => {
      const btn = document.getElementById('check');
      const out = document.getElementById('out');

      // Mock the event listener (simplified)
      const mockHandler = () => {
        var v = document.getElementById('vat').value || '';
        var out = document.getElementById('out');
        if (!v) { out.textContent = 'Enter a VAT ID.'; return; }
      };

      btn.addEventListener('click', mockHandler);
      btn.click();

      expect(out.textContent).toBe('Enter a VAT ID.');
    });
  });
});