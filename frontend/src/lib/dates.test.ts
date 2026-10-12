import { describe, expect, it } from "vitest";
import { formatMonth, formatUtc, isValidLocalDateTime, nowAsLocalValue, previousMonth, toUtcIso } from "./dates";

describe("dates (all UTC)", () => {
  it("turns a datetime-local value into UTC ISO", () => {
    expect(toUtcIso("2025-09-16T00:00")).toBe("2025-09-16T00:00:00Z");
    expect(toUtcIso("2025-09-16T10:30:15")).toBe("2025-09-16T10:30:15Z");
  });
  it("validates datetime-local values", () => {
    expect(isValidLocalDateTime("2025-09-16T00:00")).toBe(true);
    expect(isValidLocalDateTime("2025-13-16T00:00")).toBe(false);
    expect(isValidLocalDateTime("")).toBe(false);
    expect(isValidLocalDateTime("2025-09-16")).toBe(false);
  });
  it("formats instants and months", () => {
    expect(formatUtc("2025-09-16T05:07:00Z")).toBe("2025-09-16 05:07 UTC");
    expect(formatUtc("garbage")).toBe("garbage");
    expect(formatMonth("2025-09-01T00:00:00Z")).toBe("September 2025");
  });
  it("computes the previous billing month, across a year boundary", () => {
    expect(previousMonth(new Date("2025-10-12T10:00:00Z"))).toBe("2025-09");
    expect(previousMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2025-12");
    expect(previousMonth(new Date("2025-03-31T23:59:59Z"))).toBe("2025-02");
  });
  it("renders now as a UTC datetime-local value", () => {
    expect(nowAsLocalValue(new Date("2025-09-16T05:07:33Z"))).toBe("2025-09-16T05:07");
  });
});
