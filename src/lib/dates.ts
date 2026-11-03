/** ISO calendar-date helpers (UTC, YYYY-MM-DD). */

export type DateRange = {
  /** Inclusive start, YYYY-MM-DD. */
  from: string;
  /** Inclusive end, YYYY-MM-DD. */
  to: string;
};

const DAY_MS = 86_400_000;

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function addDays(isoDate: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(isoDate).getTime() + days * DAY_MS));
}

export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The `days`-long range ending yesterday (today's data is still incomplete). */
export function trailingRange(days: number, now: Date): DateRange {
  const to = addDays(toIsoDate(now), -1);
  return { from: addDays(to, -(days - 1)), to };
}

/** The range of equal length immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const length = eachDay(range).length;
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(length - 1)), to };
}
