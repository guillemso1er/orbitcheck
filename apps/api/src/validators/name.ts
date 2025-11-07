/**
 * Simple name validation and normalization
 * @param name - The name string to validate
 * @returns Validation result
 */
export function validateName(name: string): { valid: boolean; reason_codes: string[]; normalized: string } {
  // Handle undefined or null name
  if (!name) {
    return {
      valid: false,
      reason_codes: ['name.empty'],
      normalized: ''
    };
  }

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 100 && /^[a-zA-Z\s\-'\.]+$/.test(trimmed);

  const reason_codes: string[] = [];
  if (!valid) {
    if (trimmed.length === 0) {
      reason_codes.push('name.empty');
    } else if (trimmed.length > 100) {
      reason_codes.push('name.too_long');
    } else {
      reason_codes.push('name.invalid_characters');
    }
  }

  return {
    valid,
    reason_codes,
    normalized: trimmed
  };
}