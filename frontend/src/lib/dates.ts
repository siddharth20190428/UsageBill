// Everything in UsageBill is UTC: billing months, subscription changes and usage times. The UI says so
// next to every time input, and these helpers never use the browser's local time zone.

/** "2025-09-16T00:00" (a datetime-local value, read as UTC) -> "2025-09-16T00:00:00Z". */
export function toUtcIso(local: string): string {
  const value = local.length === 16 ? `${local}:00` : local;
  return `${value}Z`;
}

export function isValidLocalDateTime(local: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) return false;
  return !Number.isNaN(Date.parse(toUtcIso(local)));
}

/** "2025-09-16T00:00:00Z" -> "2025-09-16 00:00 UTC". */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** An invoice's period_start -> "September 2025". */
export function formatMonth(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The billing month before `now`, as "YYYY-MM" (the format the invoice endpoint takes). */
export function previousMonth(now: Date = new Date()): string {
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-based, so this is already "last month" in 1-based terms
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** The current moment as a datetime-local value in UTC, e.g. for a sensible default. */
export function nowAsLocalValue(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}
