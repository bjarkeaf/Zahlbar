import { MONTHLY, parseAmount, parseFreq } from "./format";
import type { BadLine, Color, Entry, Form, Plan, Section, Sort, View } from "./model";
import { PALETTE, SECTIONS } from "./model";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
// top-level bullets only, nested bullets are notes under an entry
const BULLET = /^([-*+][ \t]+)(.*)$/;
// name is everything before the last ": <number>", so names may contain colons
const BODY = /^(.*\S)\s*:\s*([-−]?\s*\d[\d\s.,\u00a0']*k?)(?:(?:\s+|(?=\/))(.*?))?\s*$/i;
const FENCE = /^\s*(```|~~~)/;

type Body = Omit<Entry, "line" | "raw" | "section" | "prefix">;

/** Parses the text after the bullet marker. Returns a reason string when the line isn't an entry. */
export function parseBody(body: string): Body | string {
  let s = body.trim();
  let hidden = false;
  const struck = /^~~(.*)~~$/.exec(s);
  if (struck) {
    hidden = true;
    s = (struck[1] ?? "").trim();
  }
  let attrs: string[] = [];
  const braces = /\s*\{([^{}]*)\}$/.exec(s);
  if (braces) {
    attrs = (braces[1] ?? "").split(",").map((a) => a.trim()).filter((a) => a !== "");
    s = s.slice(0, braces.index).trim();
  }
  const m = BODY.exec(s);
  if (!m) return "no amount";
  const amount = parseAmount(m[2] ?? "");
  if (amount === undefined) return `can't read the amount "${(m[2] ?? "").trim()}"`;
  const freq = m[3] ? parseFreq(m[3]) : { ...MONTHLY };
  if (!freq) return `can't read how often "${m[3]}"`;

  let form: Form = "cash";
  let color: Color | undefined;
  const extra: string[] = [];
  for (const a of attrs) {
    const low = a.toLowerCase();
    if (low === "shares" || low === "pension" || low === "cash") form = low;
    else if ((PALETTE as readonly string[]).includes(low)) color = low as Color;
    else extra.push(a);
  }
  return { name: (m[1] ?? "").trim(), amount, freq, form, color, hidden, extra };
}

function readFrontmatter(lines: string[]): { end: number; keys: Map<string, string> } {
  const keys = new Map<string, string>();
  if (lines[0]?.trim() !== "---") return { end: -1, keys };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---" || line.trim() === "...") return { end: i, keys };
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (kv) keys.set(kv[1]!.toLowerCase(), (kv[2] ?? "").replace(/^["']|["']$/g, ""));
  }
  return { end: -1, keys: new Map() };
}

export function parse(text: string): Plan {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const fm = readFrontmatter(lines);
  const view: View = fm.keys.get("view") === "year" ? "year" : "month";
  const sort: Sort = fm.keys.get("sort") === "amount" ? "amount" : "manual";
  const plan: Plan = {
    lines,
    eol,
    flagged: fm.keys.has("zahlbar"),
    title: undefined,
    currency: fm.keys.get("currency") || undefined,
    view,
    sort,
    entries: [],
    bad: [],
    headings: {}
  };

  let section: Section | undefined;
  let inFence = false;
  for (let i = fm.end + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = HEADING.exec(line);
    if (h) {
      const key = (h[2] ?? "").trim().toLowerCase();
      if ((SECTIONS as readonly string[]).includes(key)) {
        section = key as Section;
        plan.headings[section] ??= i;
      } else {
        section = undefined;
        if (h[1] === "#" && plan.title === undefined) plan.title = (h[2] ?? "").trim();
      }
      continue;
    }
    if (!section) continue;
    const b = BULLET.exec(line);
    if (!b) continue;
    const body = parseBody(b[2] ?? "");
    if (typeof body !== "string" && body.amount < 0 && section !== "saving")
      plan.bad.push({ line: i, section, text: (b[2] ?? "").trim(), reason: "only Saving lines can be negative" });
    else if (typeof body === "string") plan.bad.push({ line: i, section, text: (b[2] ?? "").trim(), reason: body } satisfies BadLine);
    else plan.entries.push({ ...body, line: i, raw: line, section, prefix: b[1] ?? "- " });
  }
  return plan;
}
