import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ordered, parse, totals } from "../src/core";

const example = readFileSync(new URL("../examples/Plan 2027.md", import.meta.url), "utf8");

describe("totals on the example plan", () => {
  const plan = parse(example);

  it("month view", () => {
    const t = totals(plan.entries, "month");
    expect(t.income).toBeCloseTo(64500);
    expect(t.tax).toBeCloseTo(22000);
    expect(t.saving).toBeCloseTo(7000);
    expect(t.living).toBeCloseTo(22450);
    expect(t.cashLeft).toBeCloseTo(3050);
    expect(t.unspent).toBeCloseTo(10000);
    expect(t.taxRate).toBeCloseTo(0.341, 3);
    expect(t.savedRate).toBeCloseTo(0.311, 3);
  });

  it("year view is 12 times the month view", () => {
    const m = totals(plan.entries, "month");
    const y = totals(plan.entries, "year");
    for (const k of ["income", "tax", "saving", "living", "cashLeft", "unspent"] as const) expect(y[k]).toBeCloseTo(m[k] * 12);
    expect(y.taxRate).toBeCloseTo(m.taxRate);
  });

  it("income equals outgoings plus what's left", () => {
    const t = totals(plan.entries, "month");
    expect(t.tax + t.saving + t.living + t.cashLeft + t.unspent).toBeCloseTo(t.income);
  });

  it("paying the vest tax in cash moves it from unspent shares to a cash cost", () => {
    const cash = parse(example.replace("12 000 quarterly {shares}", "12 000 quarterly"));
    const t = totals(cash.entries, "month");
    expect(t.cashLeft).toBeCloseTo(-950);
    expect(t.unspent).toBeCloseTo(14000);
  });
});

describe("ordered", () => {
  it("keeps file order, or sorts by yearly value", () => {
    const p = parse("## Living\n- Small: 100\n- Yearly: 10 000 yearly\n- Quarterly: 3 000 quarterly\n");
    expect(ordered(p.entries, "living", "manual").map((e) => e.name)).toEqual(["Small", "Yearly", "Quarterly"]);
    expect(ordered(p.entries, "living", "amount").map((e) => e.name)).toEqual(["Quarterly", "Yearly", "Small"]);
  });
});
