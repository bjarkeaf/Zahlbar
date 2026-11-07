import { formatAmount, freqLabel, MONTHLY, sameFreq } from "./format";
import type { Entry, Freq, Form, Color, Section } from "./model";
import { SECTION_TITLES, SECTIONS } from "./model";
import { parse } from "./parse";

/** Thrown when the entry an edit was aimed at is no longer in the note, e.g. after a hand edit. */
export class StaleError extends Error {
  constructor() {
    super("The note changed since it was read");
  }
}

export interface EntryRef {
  line: number;
  raw: string;
}

export type EntryPatch = Partial<{ name: string; amount: number; freq: Freq; form: Form; color: Color | undefined; hidden: boolean }>;

export interface NewEntry {
  name: string;
  amount: number;
  freq?: Freq;
  form?: Form;
}

/** Writes one entry line. Monthly is the default and is left out. */
export function serializeEntry(e: Pick<Entry, "prefix" | "name" | "amount" | "freq" | "form" | "color" | "hidden" | "extra">): string {
  const attrs = [...(e.form !== "cash" ? [e.form] : []), ...(e.color ? [e.color] : []), ...e.extra];
  let body = `${e.name}: ${formatAmount(e.amount, " ", "-")}`;
  if (!sameFreq(e.freq, MONTHLY)) body += ` ${freqLabel(e.freq)}`;
  if (attrs.length) body += ` {${attrs.join(", ")}}`;
  if (e.hidden) body = `~~${body}~~`;
  return e.prefix + body;
}

function locate(entries: Entry[], ref: EntryRef): Entry {
  const exact = entries.find((e) => e.line === ref.line && e.raw === ref.raw);
  if (exact) return exact;
  // the line moved (something was added above it), find it by content if that is unambiguous
  const same = entries.filter((e) => e.raw === ref.raw);
  if (same.length === 1) return same[0]!;
  throw new StaleError();
}

export function updateEntry(text: string, ref: EntryRef, patch: EntryPatch): string {
  const plan = parse(text);
  const e = locate(plan.entries, ref);
  plan.lines[e.line] = serializeEntry({ ...e, ...patch });
  return plan.lines.join(plan.eol);
}

export function removeEntry(text: string, ref: EntryRef): string {
  const plan = parse(text);
  const e = locate(plan.entries, ref);
  plan.lines.splice(e.line, 1);
  return plan.lines.join(plan.eol);
}

/** Adds an entry at the end of its section, creating the section heading if needed. Returns the new line. */
export function addEntry(text: string, section: Section, entry: NewEntry): { text: string; line: number } {
  const plan = parse(text);
  const line = serializeEntry({ prefix: "- ", color: undefined, hidden: false, extra: [], form: "cash", freq: { ...MONTHLY }, ...entry });
  const heading = plan.headings[section];
  if (heading !== undefined) {
    const last = Math.max(heading, ...[...plan.entries, ...plan.bad].filter((x) => x.section === section).map((x) => x.line));
    plan.lines.splice(last + 1, 0, line);
    return { text: plan.lines.join(plan.eol), line: last + 1 };
  }
  // put a new section after the sections that come before it, or at the end
  const order = SECTIONS.indexOf(section);
  const next = SECTIONS.slice(order + 1).map((s) => plan.headings[s]).find((h) => h !== undefined);
  const block = [`## ${SECTION_TITLES[section]}`, line, ""];
  if (next !== undefined) {
    plan.lines.splice(next, 0, ...block);
    return { text: plan.lines.join(plan.eol), line: next + 1 };
  }
  while (plan.lines.length > 0 && plan.lines[plan.lines.length - 1] === "") plan.lines.pop();
  plan.lines.push("", ...block.slice(0, 2), "");
  return { text: plan.lines.join(plan.eol), line: plan.lines.length - 2 };
}

/**
 * Moves an entry to position `to` among its section's entries. The section's entry lines keep their
 * slots, only their contents are reordered, so prose and blank lines between them stay put.
 */
export function moveEntry(text: string, ref: EntryRef, to: number): string {
  const plan = parse(text);
  const e = locate(plan.entries, ref);
  const sec = plan.entries.filter((x) => x.section === e.section);
  const from = sec.indexOf(e);
  const target = Math.max(0, Math.min(to, sec.length - 1));
  if (from === target) return text;
  const contents = sec.map((x) => plan.lines[x.line]!);
  const [moved] = contents.splice(from, 1);
  contents.splice(target, 0, moved!);
  sec.forEach((x, i) => (plan.lines[x.line] = contents[i]!));
  return plan.lines.join(plan.eol);
}

/** Sets a simple `key: value` in the frontmatter, creating the frontmatter if there is none. */
export function setMeta(text: string, key: string, value: string): string {
  const plan = parse(text);
  const lines = plan.lines;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (end > 0) {
      const at = lines.findIndex((l, i) => i > 0 && i < end && new RegExp(`^${key}\\s*:`, "i").test(l));
      if (at > 0) lines[at] = `${key}: ${value}`;
      else lines.splice(end, 0, `${key}: ${value}`);
      return lines.join(plan.eol);
    }
  }
  return ["---", `${key}: ${value}`, "---", ...lines].join(plan.eol);
}

/** An Obsidian comment (hidden when reading) that tells anyone editing the raw note where the format is described. */
export const FORMAT_POINTER = "%% Format: https://github.com/bjarkeaf/Zahlbar/blob/main/FORMAT.md %%";

export function newPlanText(title: string, currency = "DKK"): string {
  return [
    "---",
    "zahlbar: 1",
    `currency: ${currency}`,
    "---",
    `# ${title}`,
    FORMAT_POINTER,
    "",
    "## Income",
    "- Salary: 0",
    "",
    "## Tax",
    "",
    "## Saving",
    "",
    "## Living",
    ""
  ].join("\n");
}
