// Display and comparison helpers for decimal strings. The API sends exact decimals as strings; nothing
// here does arithmetic with floats. (Number() is used only to hand a value to Intl for display.)

/** "100.000000" -> "100", "0.100000" with minDecimals=2 -> "0.10", "5" with minDecimals=2 -> "5.00". */
export function trimDecimals(value: string, minDecimals = 0): string {
  const [whole, fraction = ""] = value.split(".");
  let trimmed = fraction.replace(/0+$/, "");
  while (trimmed.length < minDecimals) trimmed += "0";
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** Thousands separators on the whole part only: "1250.5" -> "1,250.5". */
export function groupThousands(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function formatQuantity(quantity: string): string {
  return groupThousands(trimDecimals(quantity));
}

/** Unit prices keep at least 2 decimals and up to 6: "0.080000" -> "0.08", "0.004000" -> "0.004". */
export function formatUnitPrice(price: string): string {
  return trimDecimals(price, 2);
}

/** "114.50", "USD" -> "$114.50". Values too large for a float to hold exactly fall back to plain text. */
export function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) return `${currency} ${groupThousands(amount)}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${amount}`; // unknown currency code
  }
}

/** Compare two non-negative decimal strings exactly, without floats. Returns -1, 0 or 1. */
export function compareDecimal(a: string, b: string): number {
  const [aWhole, aFraction = ""] = a.split(".");
  const [bWhole, bFraction = ""] = b.split(".");
  const aInt = aWhole.replace(/^0+(?=\d)/, "");
  const bInt = bWhole.replace(/^0+(?=\d)/, "");
  if (aInt.length !== bInt.length) return aInt.length < bInt.length ? -1 : 1;
  if (aInt !== bInt) return aInt < bInt ? -1 : 1;
  const width = Math.max(aFraction.length, bFraction.length);
  const x = aFraction.padEnd(width, "0");
  const y = bFraction.padEnd(width, "0");
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/** True for non-negative decimals with at most `maxDecimals` places: "10", "0.5", "1.234567". */
export function isDecimal(value: string, maxDecimals: number): boolean {
  return new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`).test(value.trim());
}

export function isZero(value: string): boolean {
  return compareDecimal(value.trim(), "0") === 0;
}
