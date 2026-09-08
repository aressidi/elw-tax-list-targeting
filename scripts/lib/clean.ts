/** Data-cleaning utilities for the County Treasurer Target List import. */

export function trimToNull(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** "SD *" -> "SD", " wy " -> "WY". Returns null if not a plausible 2-letter abbreviation. */
export function cleanStateAbbreviation(raw: string | undefined | null): string | null {
  const trimmed = trimToNull(raw);
  if (!trimmed) return null;
  const lettersOnly = trimmed.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return lettersOnly.length === 2 ? lettersOnly : null;
}

/** "Pennington County Treasurer" -> "Pennington", "Ada Treasurer" -> "Ada". */
export function cleanCountyName(raw: string | undefined | null): string | null {
  const trimmed = trimToNull(raw);
  if (!trimmed) return null;
  let cleaned = trimmed;
  cleaned = cleaned.replace(/\s+county\s+treasurer$/i, '');
  cleaned = cleaned.replace(/\s+treasurer$/i, '');
  cleaned = cleaned.replace(/\s+county$/i, '');
  return trimToNull(cleaned);
}

/** Strips non-numeric characters and formats 10-digit US numbers as (XXX) XXX-XXXX. */
export function normalizePhoneNumber(raw: string | undefined | null): string | null {
  const trimmed = trimToNull(raw);
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return digits.length > 0 ? digits : null;
}

/** Lowercases and trims; "N/A" (any case) becomes null. */
export function normalizeEmail(raw: string | undefined | null): string | null {
  const trimmed = trimToNull(raw);
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'n/a') return null;
  return trimmed.toLowerCase();
}

export function normalizeTitle(raw: string | undefined | null): string {
  return trimToNull(raw) ?? 'Tax Collector';
}

/** Removes keys whose value is `undefined` so partial updates don't clobber existing data. */
export function omitUndefined<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}
