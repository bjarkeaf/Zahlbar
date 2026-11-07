import type { Freq, Unit } from "./model";

export const PER_YEAR: Record<Unit, number> = { day: 365, week: 52, month: 12, year: 1 };
export const UNITS: Unit[] = ["day", "week", "month", "year"];
export const MONTHLY: Freq = { n: 1, unit: "month" };
export const YEARLY: Freq = { n: 1, unit: "year" };

export const PRESETS: Array<[Freq, string]> = [
  [{ n: 1, unit: "week" }, "weekly"],
  [MONTHLY, "monthly"],
  [{ n: 3, unit: "month" }, "quarterly"],
  [{ n: 6, unit: "month" }, "half-yearly"],
  [YEARLY, "yearly"]
];

export const sameFreq = (a: Freq, b: Freq): boolean => a.n === b.n && a.unit === b.unit;
export const perYear = (f: Freq): number => PER_YEAR[f.unit] / f.n;

export function freqLabel(f: Freq): string {
  const preset = PRESETS.find(([p]) => sameFreq(p, f));
  if (preset) return preset[1];
  if (f.n === 1) return f.unit === "day" ? "daily" : `every ${f.unit}`;
  return `every ${f.n} ${f.unit}s`;
}

const ALIASES: Record<string, Freq> = {
  mo: MONTHLY, month: MONTHLY, monthly: MONTHLY,
  q: { n: 3, unit: "month" }, quarter: { n: 3, unit: "month" }, quarterly: { n: 3, unit: "month" },
  h: { n: 6, unit: "month" }, half: { n: 6, unit: "month" }, "half-year": { n: 6, unit: "month" }, "half-yearly": { n: 6, unit: "month" },
  y: YEARLY, year: YEARLY, yearly: YEARLY, annually: YEARLY, annual: YEARLY,
  w: { n: 1, unit: "week" }, week: { n: 1, unit: "week" }, weekly: { n: 1, unit: "week" },
  biweekly: { n: 2, unit: "week" }, fortnightly: { n: 2, unit: "week" },
  d: { n: 1, unit: "day" }, day: { n: 1, unit: "day" }, daily: { n: 1, unit: "day" }
};

/** Reads "quarterly", "/q", "every 6 weeks", "every year". Returns undefined when it can't. */
export function parseFreq(text: string): Freq | undefined {
  const t = text.trim().toLowerCase().replace(/^\//, "").replace(/\s+/g, " ");
  if (t === "") return undefined;
  const alias = ALIASES[t];
  if (alias) return { ...alias };
  const m = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(t);
  if (!m) return undefined;
  const n = m[1] ? Number(m[1]) : 1;
  return n >= 1 ? { n, unit: m[2] as Unit } : undefined;
}

/**
 * Reads amounts written in either Danish or English style. A single `.` or `,` followed by exactly
 * three digits is a thousands separator (42.000 and 42,000 are both 42000), otherwise it is a decimal.
 */
export function parseAmount(text: string): number | undefined {
  let t = text.trim().toLowerCase().replace(/[\s\u00a0\u202f_']/g, "");
  // a minus (ASCII or typographic) means money going the other way, only allowed on saving lines
  const sign = /^[-−]/.test(t) ? -1 : 1;
  t = t.replace(/^[-−]/, "");
  let mult = 1;
  if (t.endsWith("k")) {
    mult = 1000;
    t = t.slice(0, -1);
  }
  if (!/^\d[\d.,]*$/.test(t) || /[.,]$/.test(t)) return undefined;
  if (mult === 1 && /^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, "");
  else {
    const sep = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    if (sep >= 0) t = t.slice(0, sep).replace(/[.,]/g, "") + "." + t.slice(sep + 1);
  }
  const n = Number(t) * mult * sign;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 + 0 : undefined;
}

/** "42000" -> "42 000". The note uses plain spaces and "-", the UI passes a no-break space and "−". */
export function formatAmount(n: number, sep = " ", minus = "−"): string {
  const neg = n < 0;
  const abs = Math.abs(Math.round(n * 100) / 100);
  const [int, dec] = abs.toString().split(".");
  const grouped = (int ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return (neg ? minus : "") + grouped + (dec ? "." + dec : "");
}

/** Whole numbers for display, so the chart and totals don't show stray decimals. */
export const formatRounded = (n: number, sep = "\u00a0"): string => formatAmount(Math.round(n), sep);

/** Short axis label: 25000 -> "25k". */
export const formatTick = (n: number): string => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** What you type in an amount field: "120k yearly", "42 000 every 2 years", or just "4000". */
export function parseAmountInput(text: string): { amount: number; freq: Freq | undefined } | undefined {
  const m = /^\s*([-−]?[\d\s.,\u00a0']*\d[.,\d]*\s*k?)\s*(.*?)\s*$/i.exec(text);
  if (!m) return undefined;
  const amount = parseAmount(m[1] ?? "");
  if (amount === undefined) return undefined;
  if (!m[2]) return { amount, freq: undefined };
  const freq = parseFreq(m[2]);
  return freq ? { amount, freq } : undefined;
}
