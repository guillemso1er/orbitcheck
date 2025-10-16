describe('CPF/CNPJ Checker Tests', () => {
  // Test helper functions
  describe('onlyDigits', () => {
    test('removes non-digit characters', () => {
      const onlyDigits = (s) => (s || '').replace(/\D/g, '');

      expect(onlyDigits('123.456.789-09')).toBe('12345678909');
      expect(onlyDigits('12.345.678/0001-95')).toBe('12345678000195');
    });
  });

  describe('isRepeated', () => {
    test('detects repeated digits', () => {
      const isRepeated = (s) => /^(\d)\1+$/.test(s);

      expect(isRepeated('11111111111')).toBe(true);
      expect(isRepeated('12345678909')).toBe(false);
    });
  });

  // Test CPF validation
  describe('cpfValid', () => {
    test('valid CPF', () => {
      const onlyDigits = (s) => (s || '').replace(/\D/g, '');
      const isRepeated = (s) => /^(\d)\1+$/.test(s);

      const cpfValid = (s) => {
        s = onlyDigits(s);
        if (s.length !== 11 || isRepeated(s)) return false;
        var sum = 0;
        for (var i = 0; i < 9; i++) sum += parseInt(s[i]) * (10 - i);
        var d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
        if (d1 !== parseInt(s[9])) return false;
        sum = 0;
        for (i = 0; i < 10; i++) sum += parseInt(s[i]) * (11 - i);
        var d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
        return d2 === parseInt(s[10]);
      };

      expect(cpfValid('12345678909')).toBe(true); // Example valid CPF
    });

    test('invalid CPF - repeated digits', () => {
      const onlyDigits = (s) => (s || '').replace(/\D/g, '');
      const isRepeated = (s) => /^(\d)\1+$/.test(s);

      const cpfValid = (s) => {
        s = onlyDigits(s);
        if (s.length !== 11 || isRepeated(s)) return false;
        var sum = 0;
        for (var i = 0; i < 9; i++) sum += parseInt(s[i]) * (10 - i);
        var d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
        if (d1 !== parseInt(s[9])) return false;
        sum = 0;
        for (i = 0; i < 10; i++) sum += parseInt(s[i]) * (11 - i);
        var d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
        return d2 === parseInt(s[10]);
      };

      expect(cpfValid('11111111111')).toBe(false);
    });
  });

  // Test CNPJ validation
  describe('cnpjValid', () => {
    test('valid CNPJ', () => {
      const onlyDigits = (s) => (s || '').replace(/\D/g, '');
      const isRepeated = (s) => /^(\d)\1+$/.test(s);

      const cnpjValid = (s) => {
        s = onlyDigits(s);
        if (s.length !== 14 || isRepeated(s)) return false;
        var b1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], b2 = [6].concat(b1);
        function calc(base, len) {
          var sum = 0; for (var i = 0; i < len; i++) sum += parseInt(s[i]) * base[i];
          var rest = sum % 11; return (rest < 2) ? 0 : 11 - rest;
        }
        var d1 = calc(b1, 12); if (d1 !== parseInt(s[12])) return false;
        var d2 = calc(b2, 13); return d2 === parseInt(s[13]);
      };

      expect(cnpjValid('12345678000195')).toBe(true); // Example valid CNPJ
    });

    test('invalid CNPJ - repeated digits', () => {
      const onlyDigits = (s) => (s || '').replace(/\D/g, '');
      const isRepeated = (s) => /^(\d)\1+$/.test(s);

      const cnpjValid = (s) => {
        s = onlyDigits(s);
        if (s.length !== 14 || isRepeated(s)) return false;
        var b1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], b2 = [6].concat(b1);
        function calc(base, len) {
          var sum = 0; for (var i = 0; i < len; i++) sum += parseInt(s[i]) * base[i];
          var rest = sum % 11; return (rest < 2) ? 0 : 11 - rest;
        }
        var d1 = calc(b1, 12); if (d1 !== parseInt(s[12])) return false;
        var d2 = calc(b2, 13); return d2 === parseInt(s[13]);
      };

      expect(cnpjValid('11111111111111')).toBe(false);
    });
  });

  // Test button click functionality
  describe('CPF/CNPJ checker button click', () => {
    beforeEach(() => {
      // Set up DOM elements
      document.body.innerHTML = `
        <input id="id" />
        <button id="go">Validate</button>
        <div id="out"></div>
      `;
    });

    test('validate CPF', () => {
      const go = document.getElementById('go');
      const out = document.getElementById('out');
      const idInput = document.getElementById('id');

      const onlyDigits = (s) => (s || '').replace(/\D/g, '');
      const isRepeated = (s) => /^(\d)\1+$/.test(s);
      const cpfValid = (s) => {
        s = onlyDigits(s);
        if (s.length !== 11 || isRepeated(s)) return false;
        var sum = 0;
        for (var i = 0; i < 9; i++) sum += parseInt(s[i]) * (10 - i);
        var d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
        if (d1 !== parseInt(s[9])) return false;
        sum = 0;
        for (i = 0; i < 10; i++) sum += parseInt(s[i]) * (11 - i);
        var d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
        return d2 === parseInt(s[10]);
      };

      const clickHandler = () => {
        var v = idInput.value || '';
        var digits = (v || '').replace(/\D/g, '');
        var out = document.getElementById('out');
        if (digits.length <= 11) {
          var ok = cpfValid(v);
          out.innerHTML = (ok ? '✅ Valid CPF' : '❌ Invalid CPF') + ' • normalized: <code>' + digits.padStart(11, '0') + '</code>';
        } else {
          var ok2 = cnpjValid(v);
          out.innerHTML = (ok2 ? '✅ Valid CNPJ' : '❌ Invalid CNPJ') + ' • normalized: <code>' + digits.padStart(14, '0') + '</code>';
        }
      };

      go.addEventListener('click', clickHandler);

      idInput.value = '123.456.789-09';
      go.click();

      expect(out.innerHTML).toContain('normalized: <code>12345678909</code>');
    });
  });
});