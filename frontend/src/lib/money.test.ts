import { describe, expect, it } from "vitest";
import { compareDecimal, formatMoney, formatQuantity, formatUnitPrice, isDecimal, isZero, trimDecimals } from "./money";

describe("trimDecimals", () => {
  it("drops trailing zeros and pads to a minimum", () => {
    expect(trimDecimals("100.000000")).toBe("100");
    expect(trimDecimals("0.100000", 2)).toBe("0.10");
    expect(trimDecimals("5", 2)).toBe("5.00");
    expect(trimDecimals("0.004000", 2)).toBe("0.004");
  });
});

describe("formatting", () => {
  it("groups thousands on the whole part only", () => {
    expect(formatQuantity("1250000.500")).toBe("1,250,000.5");
  });
  it("formats unit prices with at least 2 decimals", () => {
    expect(formatUnitPrice("0.080000")).toBe("0.08");
    expect(formatUnitPrice("2")).toBe("2.00");
  });
  it("formats money, falling back for odd input", () => {
    expect(formatMoney("114.50", "USD")).toBe("$114.50");
    expect(formatMoney("5.00", "XXQ")).toContain("5");
    expect(formatMoney("99999999999999999.00", "USD")).toBe("USD 99,999,999,999,999,999.00");
  });
});

describe("compareDecimal", () => {
  it("compares exactly, without floats", () => {
    expect(compareDecimal("0.1", "0.10")).toBe(0);
    expect(compareDecimal("9", "10")).toBe(-1);
    expect(compareDecimal("10.000001", "10")).toBe(1);
    expect(compareDecimal("007", "7")).toBe(0);
    expect(compareDecimal("12345678901234567890.1", "12345678901234567890.2")).toBe(-1);
  });
});

describe("isDecimal / isZero", () => {
  it("validates decimals with a max number of places", () => {
    expect(isDecimal("10", 2)).toBe(true);
    expect(isDecimal("10.55", 2)).toBe(true);
    expect(isDecimal("10.555", 2)).toBe(false);
    expect(isDecimal("-1", 2)).toBe(false);
    expect(isDecimal("1e3", 2)).toBe(false);
    expect(isDecimal("", 2)).toBe(false);
    expect(isDecimal(".5", 2)).toBe(false);
  });
  it("detects zero", () => {
    expect(isZero("0")).toBe(true);
    expect(isZero("0.000")).toBe(true);
    expect(isZero("0.001")).toBe(false);
  });
});
