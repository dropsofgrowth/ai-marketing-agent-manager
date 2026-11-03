/** Locale-independent formatting for text stored in the database (audit/rationale). */
export function formatPlainRoas(value: number): string {
  return value.toFixed(2);
}
