import { PHONE_NORMALIZE_REGEX, FULL_NAME_SEPARATOR } from "./validation.js";

export function normalizeEmail(email: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export function normalizePhone(phone: string | null): string | null {
  return phone ? phone.replaceAll(PHONE_NORMALIZE_REGEX, '') : null;
}

export function buildFullName(firstName: string | null, lastName: string | null): string {
  return `${firstName || ''}${FULL_NAME_SEPARATOR}${lastName || ''}`.trim();
}