import type { Entry } from "../core";
import { PALETTE } from "../core";

const hash = (name: string): number => {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % PALETTE.length;
};

export type ColorOf = (e: Entry) => number;

/**
 * Picks a colour per entry. A chosen colour wins. Otherwise the name's hash is the starting point,
 * skipping colours already used on the same bar, so neighbours rarely look alike. It goes by file
 * order, not display order, so sorting or dragging a preview doesn't recolour anything.
 */
export function colorMap(entries: Entry[]): ColorOf {
  const map = new Map<number, number>();
  const byLine = [...entries].sort((a, b) => a.line - b.line);
  for (const bar of [["income"], ["tax", "saving", "living"]]) {
    const own = byLine.filter((e) => bar.includes(e.section));
    const used = new Set(own.filter((e) => e.color).map((e) => PALETTE.indexOf(e.color!)));
    let prev = -1;
    for (const e of own) {
      let c: number;
      if (e.color) c = PALETTE.indexOf(e.color);
      else {
        c = hash(e.name);
        if (used.size < PALETTE.length) while (used.has(c)) c = (c + 1) % PALETTE.length;
        else if (c === prev) c = (c + 1) % PALETTE.length;
      }
      used.add(c);
      map.set(e.line, c);
      prev = c;
    }
  }
  return (e) => map.get(e.line) ?? hash(e.name);
}

export const fillVar = (i: number): string => `var(--earmark-c${i})`;
export const borderVar = (i: number): string => `var(--earmark-c${i}b)`;
