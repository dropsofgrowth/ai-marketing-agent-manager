import { parseIsoDate } from "@/lib/dates";

/**
 * Calendar-day helpers for an IANA time zone (e.g. the Shopify store's), so a
 * "day" of orders matches what the merchant sees in Shopify — not UTC midnight.
 */

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (e.g. +4h for Asia/Dubai). */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant (UTC) at which local calendar day `isoDate` begins in `timeZone`. DST-safe. */
export function startOfZonedDay(isoDate: string, timeZone: string): Date {
  const midnightUtc = parseIsoDate(isoDate).getTime();
  let guess = midnightUtc - offsetMs(new Date(midnightUtc), timeZone);
  // Second pass corrects for an offset change (DST) between the guess and local midnight.
  guess = midnightUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Local calendar date (YYYY-MM-DD) of `instant` in `timeZone`. */
export function zonedIsoDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}
