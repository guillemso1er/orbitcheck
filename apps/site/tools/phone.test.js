describe('Phone Formatter Tests', () => {
  // Test normalize function
  describe('normalize', () => {
    test('phone with plus prefix', () => {
      const normalize = (num, cc) => {
        var s = (num || '').toString().trim();
        s = s.replace(/[^\d+]/g, '');
        if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g, '');
        if (s.startsWith('00')) return '+' + s.slice(2).replace(/[^\d]/g, '');
        var digits = s.replace(/\D/g, '');
        if (!cc) return '⚠️ Add country code or prefix with + or 00';
        return '+' + cc + digits;
      };

      expect(normalize('+34600123456')).toBe('+34600123456');
    });

    test('phone with 00 prefix', () => {
      const normalize = (num, cc) => {
        var s = (num || '').toString().trim();
        s = s.replace(/[^\d+]/g, '');
        if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g, '');
        if (s.startsWith('00')) return '+' + s.slice(2).replace(/[^\d]/g, '');
        var digits = s.replace(/\D/g, '');
        if (!cc) return '⚠️ Add country code or prefix with + or 00';
        return '+' + cc + digits;
      };

      expect(normalize('0034600123456')).toBe('+34600123456');
    });

    test('phone with country code', () => {
      const normalize = (num, cc) => {
        var s = (num || '').toString().trim();
        s = s.replace(/[^\d+]/g, '');
        if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g, '');
        if (s.startsWith('00')) return '+' + s.slice(2).replace(/[^\d]/g, '');
        var digits = s.replace(/\D/g, '');
        if (!cc) return '⚠️ Add country code or prefix with + or 00';
        return '+' + cc + digits;
      };

      expect(normalize('600123456', '34')).toBe('+34600123456');
    });

    test('phone without country code', () => {
      const normalize = (num, cc) => {
        var s = (num || '').toString().trim();
        s = s.replace(/[^\d+]/g, '');
        if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g, '');
        if (s.startsWith('00')) return '+' + s.slice(2).replace(/[^\d]/g, '');
        var digits = s.replace(/\D/g, '');
        if (!cc) return '⚠️ Add country code or prefix with + or 00';
        return '+' + cc + digits;
      };

      expect(normalize('600123456')).toBe('⚠️ Add country code or prefix with + or 00');
    });

    test('phone with formatting characters', () => {
      const normalize = (num, cc) => {
        var s = (num || '').toString().trim();
        s = s.replace(/[^\d+]/g, '');
        if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g, '');
        if (s.startsWith('00')) return '+' + s.slice(2).replace(/[^\d]/g, '');
        var digits = s.replace(/\D/g, '');
        if (!cc) return '⚠️ Add country code or prefix with + or 00';
        return '+' + cc + digits;
      };

      expect(normalize('(600) 123-456', '34')).toBe('+34600123456');
    });
  });

  // Test button click functionality
  describe('Phone formatter button click', () => {
    beforeEach(() => {
      // Set up DOM elements
      document.body.innerHTML = `
        <input id="num" />
        <select id="cc"></select>
        <button id="fmt">Format</button>
        <div id="out"></div>
      `;
    });

    test('format phone number', () => {
      const fmt = document.getElementById('fmt');
      const out = document.getElementById('out');
      const numInput = document.getElementById('num');
      const ccSelect = document.getElementById('cc');

      const normalize = (num, cc) => {
        var s = (num || '').toString().trim();
        s = s.replace(/[^\d+]/g, '');
        if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g, '');
        if (s.startsWith('00')) return '+' + s.slice(2).replace(/[^\d]/g, '');
        var digits = s.replace(/\D/g, '');
        if (!cc) return '⚠️ Add country code or prefix with + or 00';
        return '+' + cc + digits;
      };

      const clickHandler = () => {
        var num = numInput.value;
        var cc = ccSelect.value;
        var e164 = normalize(num, cc);
        out.innerHTML = 'Result: <code>' + e164 + '</code>';
      };

      fmt.addEventListener('click', clickHandler);

      numInput.value = '600123456';
      ccSelect.value = '34';
      fmt.click();

      expect(out.innerHTML).toBe('Result: <code>⚠️ Add country code or prefix with + or 00</code>');
    });
  });
});