import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addEntry, moveEntry, parse, removeEntry, serializeEntry, setMeta, StaleError, updateEntry } from "../src/core";

const example = readFileSync(new URL("../examples/Plan 2027.md", import.meta.url), "utf8");
const ref = (text: string, name: string) => {
  const e = parse(text).entries.find((x) => x.name === name)!;
  return { line: e.line, raw: e.raw };
};
const changedLines = (a: string, b: string) => {
  const x = a.split("\n"), y = b.split("\n");
  return x.map((l, i) => (l === y[i] ? -1 : i)).filter((i) => i >= 0);
};

describe("parse", () => {
  const plan = parse(example);

  it("reads frontmatter and title", () => {
    expect(plan.flagged).toBe(true);
    expect(plan.currency).toBe("DKK");
    expect(plan.view).toBe("month");
    expect(plan.sort).toBe("manual");
    expect(plan.title).toBe("Plan 2027");
  });

  it("reads every entry with its section, frequency and attributes", () => {
    expect(plan.entries).toHaveLength(18);
    expect(plan.bad).toHaveLength(0);
    const vest = plan.entries.find((e) => e.name === "Stock vest")!;
    expect(vest).toMatchObject({ section: "income", amount: 30000, freq: { n: 3, unit: "month" }, form: "shares", hidden: false });
    const car = plan.entries.find((e) => e.name === "Car")!;
    expect(car).toMatchObject({ section: "living", amount: 3000, hidden: true });
    expect(plan.entries.find((e) => e.name === "Haircut")!.freq).toEqual({ n: 6, unit: "week" });
    expect(plan.entries.find((e) => e.name === "Tax on vest")).toMatchObject({ section: "tax", form: "shares" });
  });

  it("keeps lines it doesn't understand and says why", () => {
    const p = parse("---\nzahlbar: 1\n---\n## Living\n- Gym: tbd\n- Rent: 9 500\n- Trip: 5 000 sometimes\n");
    expect(p.entries.map((e) => e.name)).toEqual(["Rent"]);
    expect(p.bad.map((b) => [b.text, b.reason])).toEqual([
      ["Gym: tbd", "no amount"],
      ["Trip: 5 000 sometimes", 'can\'t read how often "sometimes"']
    ]);
  });

  it("handles colons in names, colours, unknown attributes and other bullet markers", () => {
    const p = parse("## Living\n* Note: rent: 9 500 {rose, fixed}\n+ Gym: 300/mo\n");
    expect(p.entries[0]).toMatchObject({ name: "Note: rent", amount: 9500, color: "rose", extra: ["fixed"], prefix: "* " });
    expect(p.entries[1]).toMatchObject({ name: "Gym", amount: 300, freq: { n: 1, unit: "month" } });
  });

  it("reads negative saving lines, and refuses negatives elsewhere", () => {
    const p = parse("## Saving\n- Sell shares: -5 000 {shares}\n- Buffer: −1.000\n## Living\n- Refund: -100\n");
    expect(p.entries.map((e) => [e.name, e.amount])).toEqual([["Sell shares", -5000], ["Buffer", -1000]]);
    expect(p.bad).toMatchObject([{ text: "Refund: -100", reason: "only Saving lines can be negative" }]);
    expect(serializeEntry(p.entries[1]!)).toBe("- Buffer: -1 000");
  });

  it("ignores bullets outside sections, nested bullets and code blocks", () => {
    const p = parse("- Loose: 5\n## Income\n- Salary: 100\n  - note: 5\n```\n- Fake: 5\n```\n## Other\n- Elsewhere: 5\n");
    expect(p.entries.map((e) => e.name)).toEqual(["Salary"]);
  });

  it("is not flagged without the zahlbar key", () => {
    expect(parse("# Notes\n## Income\n- Salary: 1\n").flagged).toBe(false);
  });
});

describe("write", () => {
  it("rewrites the example unchanged, line by line", () => {
    const plan = parse(example);
    for (const e of plan.entries) expect(serializeEntry(e)).toBe(e.raw);
  });

  it("changes exactly one line per edit", () => {
    const out = updateEntry(example, ref(example, "Rent"), { amount: 10000 });
    expect(changedLines(example, out)).toHaveLength(1);
    expect(out).toContain("- Rent: 10 000\n");
  });

  it("writes frequency, form, colour and hidden", () => {
    let t = updateEntry(example, ref(example, "Food"), { freq: { n: 2, unit: "week" } });
    t = updateEntry(t, ref(t, "Food"), { color: "rose", hidden: true });
    expect(t).toContain("- ~~Food: 4 000 every 2 weeks {rose}~~\n");
    t = updateEntry(t, ref(t, "Tax on vest"), { form: "cash" });
    expect(t).toContain("- Tax on vest: 12 000 quarterly\n");
  });

  it("adds to the end of a section, or creates the section", () => {
    const a = addEntry(example, "saving", { name: "Buffer", amount: 1000 });
    const lines = a.text.split("\n");
    expect(lines[a.line]).toBe("- Buffer: 1 000");
    expect(lines[a.line - 1]).toBe("- Stock purchase plan: 5 000");

    const b = addEntry("---\nzahlbar: 1\n---\n## Income\n- Salary: 1\n\n## Living\n- Rent: 1\n", "tax", { name: "Tax", amount: 5 });
    expect(b.text).toBe("---\nzahlbar: 1\n---\n## Income\n- Salary: 1\n\n## Tax\n- Tax: 5\n\n## Living\n- Rent: 1\n");
    const c = addEntry("# Plan\n", "income", { name: "Salary", amount: 2 });
    expect(c.text).toBe("# Plan\n\n## Income\n- Salary: 2\n");
  });

  it("removes a line", () => {
    const out = removeEntry(example, ref(example, "Car"));
    expect(out).not.toContain("Car");
    expect(out.split("\n")).toHaveLength(example.split("\n").length - 1);
  });

  it("moves within a section and leaves other lines in place", () => {
    const t = "## Living\n- A: 1\n- B: 2\n\nA note.\n- C: 3\n## Tax\n- T: 1\n";
    expect(moveEntry(t, ref(t, "C"), 0)).toBe("## Living\n- C: 3\n- A: 1\n\nA note.\n- B: 2\n## Tax\n- T: 1\n");
    expect(moveEntry(t, ref(t, "A"), 2)).toBe("## Living\n- B: 2\n- C: 3\n\nA note.\n- A: 1\n## Tax\n- T: 1\n");
  });

  it("finds an entry that moved, and refuses one that changed", () => {
    const shifted = "Intro line\n" + example;
    const r = ref(example, "Rent");
    expect(updateEntry(shifted, r, { amount: 1 })).toContain("- Rent: 1\n");
    const edited = example.replace("- Rent: 9 500", "- Rent: 9 900");
    expect(() => updateEntry(edited, r, { amount: 1 })).toThrow(StaleError);
  });

  it("sets frontmatter keys", () => {
    expect(setMeta(example, "view", "year")).toContain("currency: DKK\nview: year\n---");
    expect(setMeta(setMeta(example, "view", "year"), "view", "month")).toContain("view: month\n---");
    expect(setMeta("# Plan\n", "sort", "amount")).toBe("---\nsort: amount\n---\n# Plan\n");
  });

  it("keeps CRLF line endings", () => {
    const crlf = example.replace(/\n/g, "\r\n");
    const out = updateEntry(crlf, ref(crlf, "Rent"), { amount: 1 });
    expect(out).toContain("- Rent: 1\r\n");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
