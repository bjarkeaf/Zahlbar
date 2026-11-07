export const SECTIONS = ["income", "tax", "saving", "living"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_TITLES: Record<Section, string> = { income: "Income", tax: "Tax", saving: "Saving", living: "Living" };

export type Unit = "day" | "week" | "month" | "year";
/** "Every n units". Presets like quarterly are just named values (every 3 months). */
export interface Freq {
  n: number;
  unit: Unit;
}

/**
 * What kind of money it is. Income: received as cash, shares or pension. Tax: paid with cash, or shares (sell-to-cover).
 * Saving: what the cash goes into. It is still paid in cash. Living is always cash.
 */
export type Form = "cash" | "shares" | "pension";

export const PALETTE = ["beige", "cyan", "green", "lilac", "sand", "blue", "rose", "mint", "stone", "lavender"] as const;
export type Color = (typeof PALETTE)[number];

export type View = "month" | "year";
export type Sort = "manual" | "amount";

export interface Entry {
  /** 0-based line in the note, also the entry's identity until the next parse */
  line: number;
  /** the line as it was read, used to detect that the note changed underneath us */
  raw: string;
  section: Section;
  name: string;
  amount: number;
  freq: Freq;
  form: Form;
  color: Color | undefined;
  hidden: boolean;
  /** attributes we don't understand, kept as-is */
  extra: string[];
  /** the bullet marker and its spacing, e.g. "- " */
  prefix: string;
}

export interface BadLine {
  line: number;
  section: Section;
  text: string;
  reason: string;
}

export interface Plan {
  lines: string[];
  eol: string;
  /** true when the frontmatter has an `zahlbar:` key */
  flagged: boolean;
  title: string | undefined;
  currency: string | undefined;
  view: View;
  sort: Sort;
  entries: Entry[];
  bad: BadLine[];
  /** line of the first heading for each section present in the note */
  headings: Partial<Record<Section, number>>;
}
