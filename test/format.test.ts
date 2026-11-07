import { describe, expect, it } from "vitest";
import { formatAmount, freqLabel, parseAmount, parseAmountInput, parseFreq, perYear } from "../src/core";

describe("parseAmount", () => {
  it.each([
    ["42000", 42000],
    ["42 000", 42000],
    ["42,000", 42000],
    ["42.000", 42000],
    ["1.234.567", 1234567],
    ["42k", 42000],
    ["1.5k", 1500],
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["1 234.50", 1234.5],
    ["9 500", 9500]
  ])("%s -> %d", (text, n) => expect(parseAmount(text)).toBe(n));

  it.each(["", "abc", "12.", "-5", "5,"])("rejects %j", (text) => expect(parseAmount(text)).toBeUndefined());
});

describe("formatAmount", () => {
  it("groups thousands with a space", () => {
    expect(formatAmount(42000)).toBe("42 000");
    expect(formatAmount(1234567.5)).toBe("1 234 567.5");
    expect(formatAmount(600)).toBe("600");
    expect(formatAmount(-2450)).toBe("−2 450");
  });
  it("round-trips through parseAmount", () => {
    for (const n of [0, 7, 999, 1000, 42000, 1234567, 12.5, 1234.25]) expect(parseAmount(formatAmount(n))).toBe(n);
  });
});

describe("frequencies", () => {
  it.each([
    ["monthly", "monthly", 12],
    ["/q", "quarterly", 4],
    ["quarterly", "quarterly", 4],
    ["half-yearly", "half-yearly", 2],
    ["yearly", "yearly", 1],
    ["weekly", "weekly", 52],
    ["biweekly", "every 2 weeks", 26],
    ["every 6 weeks", "every 6 weeks", 52 / 6],
    ["every 2 years", "every 2 years", 0.5],
    ["every 24 months", "every 24 months", 0.5],
    ["every 10 days", "every 10 days", 36.5],
    ["every day", "daily", 365],
    ["Every  3  Months", "quarterly", 4]
  ])("%s", (text, label, n) => {
    const f = parseFreq(text)!;
    expect(freqLabel(f)).toBe(label);
    expect(perYear(f)).toBeCloseTo(n);
    expect(parseFreq(freqLabel(f))).toEqual(f);
  });

  it.each(["3 times a year", "every 0 weeks", "sometimes", ""])("rejects %j", (t) => expect(parseFreq(t)).toBeUndefined());
});

describe("parseAmountInput", () => {
  it("reads an amount with an optional frequency", () => {
    expect(parseAmountInput("4000")).toEqual({ amount: 4000, freq: undefined });
    expect(parseAmountInput("120k yearly")).toEqual({ amount: 120000, freq: { n: 1, unit: "year" } });
    expect(parseAmountInput("42 000 every 2 years")).toEqual({ amount: 42000, freq: { n: 2, unit: "year" } });
    expect(parseAmountInput("30 000 /q")).toEqual({ amount: 30000, freq: { n: 3, unit: "month" } });
    expect(parseAmountInput("30 000 now")).toBeUndefined();
    expect(parseAmountInput("lots")).toBeUndefined();
  });
});
