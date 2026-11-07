import { perYear } from "./format";
import type { Entry, Section, Sort, View } from "./model";

export const yearly = (e: Entry): number => e.amount * perYear(e.freq);
/** The entry's value in the current view: per year, or the yearly value averaged per month. */
export const shown = (e: Entry, view: View): number => yearly(e) / (view === "month" ? 12 : 1);

export interface Totals {
  income: number;
  tax: number;
  saving: number;
  living: number;
  cashIn: number;
  cashOut: number;
  /** cash income minus everything paid in cash. Negative is a shortfall. */
  cashLeft: number;
  /** non-cash income (shares, pension) not used to pay tax by selling shares. Saving that happens by itself. */
  unspent: number;
  taxRate: number;
  /** (income - tax - living) / income, covering every form of saving */
  savedRate: number;
}

export function totals(entries: Entry[], view: View): Totals {
  const visible = entries.filter((e) => !e.hidden);
  const sum = (pick: (e: Entry) => boolean) => visible.filter(pick).reduce((s, e) => s + shown(e, view), 0);
  const income = sum((e) => e.section === "income");
  const tax = sum((e) => e.section === "tax");
  const saving = sum((e) => e.section === "saving");
  const living = sum((e) => e.section === "living");
  const cashIn = sum((e) => e.section === "income" && e.form === "cash");
  const cashOut = sum((e) => e.section !== "income" && e.form === "cash");
  const paidInShares = sum((e) => e.section !== "income" && e.form !== "cash");
  const rate = (n: number) => (income > 0 ? n / income : 0);
  return {
    income,
    tax,
    saving,
    living,
    cashIn,
    cashOut,
    cashLeft: cashIn - cashOut,
    unspent: income - cashIn - paidInShares,
    taxRate: rate(tax),
    savedRate: rate(income - tax - living)
  };
}

/** A section's entries in display order. "amount" sorts by yearly value, largest first, so the order is the same in both views. */
export function ordered(entries: Entry[], section: Section, sort: Sort): Entry[] {
  const list = entries.filter((e) => e.section === section);
  return sort === "amount" ? [...list].sort((a, b) => Math.abs(yearly(b)) - Math.abs(yearly(a))) : list;
}
