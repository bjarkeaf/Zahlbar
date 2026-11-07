import type { Entry, Sort, Totals, View } from "../core";
import { formatRounded, formatTick, ordered, shown } from "../core";
import type { ColorOf } from "./colors";
import { borderVar, fillVar } from "./colors";
import { s } from "./dom";

/** Segments thinner than this (px) are merged with their thin neighbours into "N small items". */
const MIN_LABEL = 22;

export type SegKind = "entry" | "small" | "unspent" | "left" | "short";
interface Seg {
  kind: SegKind;
  ids: string[];
  v: number;
  name: string;
  color: number;
  hatch: boolean;
  group: string;
}

export interface ChartInput {
  entries: Entry[];
  totals: Totals;
  view: View;
  sort: Sort;
  /** unique per view, so pattern ids don't clash between two open panes */
  uid: string;
  colorOf: ColorOf;
}

export const entryId = (e: Entry): string => String(e.line);

function niceStep(max: number, px: number): number {
  const n = Math.max(3, Math.min(10, Math.floor(px / 70)));
  const raw = max / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function mergeSmall(segs: Seg[], k: number): Seg[] {
  const out: Seg[] = [];
  for (const sg of segs) {
    const prev = out[out.length - 1];
    const small = sg.kind === "entry" && sg.v * k < MIN_LABEL;
    if (small && prev && (prev.kind === "small" || (prev.kind === "entry" && prev.v * k < MIN_LABEL)) && prev.group === sg.group) {
      prev.kind = "small";
      prev.v += sg.v;
      prev.ids.push(...sg.ids);
      prev.name = `${prev.ids.length} small items`;
    } else out.push({ ...sg, ids: [...sg.ids] });
  }
  return out;
}

const GROUP_NAMES: Record<string, string> = { tax: "Tax", saving: "Saving", living: "Living", left: "Left over" };

/** Draws both bars into `svg` at its real pixel size. Bars fill bottom-up, first entry on the baseline. */
export function drawChart(svg: SVGSVGElement, input: ChartInput, W: number, Hbox: number): void {
  svg.replaceChildren();
  if (W < 120 || Hbox < 120) return;
  const { totals: T, view, uid } = input;
  const visible = input.entries.filter((e) => !e.hidden);
  const toSeg = (e: Entry): Seg => ({ kind: "entry", ids: [entryId(e)], v: shown(e, view), name: e.name, color: input.colorOf(e), hatch: e.form !== "cash", group: e.section });

  let s1 = ordered(visible, "income", input.sort).map(toSeg);
  let s2 = (["tax", "saving", "living"] as const).flatMap((sec) => ordered(visible, sec, input.sort).map(toSeg));
  if (T.unspent > 0.5) s2.push({ kind: "unspent", ids: ["unspent"], v: T.unspent, name: "Shares & pension", color: 0, hatch: true, group: "left" });
  if (T.cashLeft > 0.5) s2.push({ kind: "left", ids: ["left"], v: T.cashLeft, name: "Cash left over", color: 0, hatch: false, group: "left" });
  if (T.cashLeft < -0.5) s1.push({ kind: "short", ids: ["short"], v: -T.cashLeft, name: "Shortfall", color: 0, hatch: true, group: "short" });
  s1 = s1.filter((x) => x.v > 0);
  s2 = s2.filter((x) => x.v > 0);

  const top = 22, bottom = Hbox - 40, H = bottom - top;
  const bw = Math.max(80, Math.min(170, W / 4.6));
  const gap = Math.max(32, Math.min(140, W * 0.13));
  // lay out from the axis labels to the % labels, then centre that block in the available width
  const content = 40 + 16 + bw + gap + bw + 8 + 110;
  const axL = 40 + Math.max(0, (W - content) / 2);
  const b1x = axL + 16, b2x = b1x + bw + gap, brx = b2x + bw + 8;
  const pctX = Math.min(W, brx + 110);
  const T1 = s1.reduce((a, x) => a + x.v, 0), T2 = s2.reduce((a, x) => a + x.v, 0);
  const M = Math.max(T1, T2, 1);
  const step = niceStep(M, H);
  const axisMax = Math.ceil(M / step) * step;
  const k = H / axisMax;
  const y = (v: number) => bottom - v * k;
  s1 = mergeSmall(s1, k);
  s2 = mergeSmall(s2, k);

  svg.setAttribute("viewBox", `0 0 ${W} ${Hbox}`);
  const defs = s("defs");
  const hatch = (id: string, bg: string | null, line: string, opacity = 0.7) =>
    s("pattern", { id, patternUnits: "userSpaceOnUse", width: 7, height: 7, patternTransform: "rotate(45)" },
      bg ? s("rect", { width: 7, height: 7, style: `fill:${bg}` }) : null,
      s("line", { x1: 1, y1: 0, x2: 1, y2: 7, style: `stroke:${line}`, "stroke-width": 1.6, opacity }));
  for (let i = 0; i < 10; i++) defs.append(hatch(`${uid}-h${i}`, fillVar(i), borderVar(i)));
  defs.append(hatch(`${uid}-hn`, null, "var(--earmark-neutral-b)", 1), hatch(`${uid}-he`, null, "var(--text-error)", 0.55));
  svg.append(defs);

  for (let v = 0; v <= axisMax + 0.1; v += step) {
    svg.append(s("line", { class: "earmark-grid", x1: axL, x2: brx + 4, y1: y(v), y2: y(v) }));
    svg.append(s("text", { class: "earmark-faint", x: axL - 6, y: y(v) + 3.5, "text-anchor": "end" }, formatTick(v)));
  }
  if (T.income > 0) {
    for (let p = 0; p <= (axisMax / T.income) * 100 + 0.1; p += 25)
      svg.append(s("text", { class: p === 100 ? "earmark-bold earmark-muted earmark-small" : "earmark-faint", x: pctX, y: y((p / 100) * T.income) + 3.5, "text-anchor": "end" }, `${p}%`));
    svg.append(s("line", { class: "earmark-ref", x1: axL, x2: pctX - 32, y1: y(T.income), y2: y(T.income) }));
  }

  const per = view === "month" ? "/mo" : "/y";
  const title = (x: number, name: string, sub: string) => {
    svg.append(s("text", { class: "earmark-bold earmark-title", x: x + bw / 2, y: bottom + 18, "text-anchor": "middle" }, name));
    svg.append(s("text", { class: "earmark-faint", x: x + bw / 2, y: bottom + 33, "text-anchor": "middle" }, sub));
  };
  title(b1x, "Income", `${formatRounded(T.income)} ${per}`);
  title(b2x, "Outgoings", `${formatRounded(T.tax + T.saving + T.living)} ${per}`);

  const fits = (t: string) => t.length * 6.4 < bw - 10;
  const bar = (segs: Seg[], x: number) => {
    let acc = 0;
    for (const sg of segs) {
      const yt = y(acc + sg.v), h = sg.v * k, gy = yt + 1, gh = Math.max(h - 2, 0.8), r = Math.min(6, gh / 2);
      acc += sg.v;
      let fill: string, stroke: string, dash: string | undefined;
      if (sg.kind === "unspent") [fill, stroke] = [`url(#${uid}-hn)`, "var(--earmark-neutral-b)"];
      else if (sg.kind === "left") [fill, stroke, dash] = ["transparent", "var(--earmark-neutral-b)", "4 3"];
      else if (sg.kind === "short") [fill, stroke, dash] = [`url(#${uid}-he)`, "var(--text-error)", "4 3"];
      else if (sg.kind === "small") [fill, stroke] = ["var(--earmark-neutral)", "var(--earmark-neutral-b)"];
      else [fill, stroke] = [sg.hatch ? `url(#${uid}-h${sg.color})` : fillVar(sg.color), borderVar(sg.color)];
      const g = s("g", { class: "earmark-seg", "data-ids": sg.ids.join(" "), "data-kind": sg.kind });
      g.append(s("rect", { x, y: gy, width: bw, height: gh, rx: r, style: `fill:${fill};stroke:${stroke}`, "stroke-dasharray": dash }));
      const cx = x + bw / 2;
      const pct = T.income > 0 ? Math.round((sg.v / T.income) * 100) : 0;
      const err = sg.kind === "short" ? "earmark-error" : "";
      const plate = sg.hatch || sg.kind === "unspent" || sg.kind === "short";
      if (gh >= 50 && fits(sg.name)) {
        if (plate) g.append(s("rect", { class: "earmark-plate", x: cx - 50, y: gy + gh / 2 - 24, width: 100, height: 48, rx: 4 }));
        g.append(s("text", { x: cx, y: gy + gh / 2 - 8, "text-anchor": "middle", class: err }, sg.name));
        g.append(s("text", { x: cx, y: gy + gh / 2 + 7, "text-anchor": "middle", class: `earmark-bold ${err}` }, formatRounded(sg.v)));
        g.append(s("text", { x: cx, y: gy + gh / 2 + 20, "text-anchor": "middle", class: "earmark-faint" }, `${pct}%`));
      } else if (gh >= 17) {
        let t = `${sg.name} ${formatRounded(sg.v)}`;
        if (!fits(t)) t = fits(sg.name) ? sg.name : formatRounded(sg.v);
        if (plate) g.append(s("rect", { class: "earmark-plate", x: cx - t.length * 3.4 - 5, y: gy + gh / 2 - 8, width: t.length * 6.8 + 10, height: 16, rx: 4 }));
        g.append(s("text", { x: cx, y: gy + gh / 2 + 4, "text-anchor": "middle", class: `earmark-small ${err}` }, t));
      }
      svg.append(g);
    }
  };
  bar(s1, b1x);
  bar(s2, b2x);
  if (T.cashLeft < -0.5)
    svg.append(s("text", { x: b1x + bw / 2, y: y(T1) - 6, "text-anchor": "middle", class: "earmark-bold earmark-error earmark-small" }, `${formatRounded(-T.cashLeft)} short`));

  // brackets marking the groups on the Outgoings bar
  let acc = 0;
  const groups: Array<{ key: string; a: number; v: number }> = [];
  for (const sg of s2) {
    const last = groups[groups.length - 1];
    if (!last || last.key !== sg.group) groups.push({ key: sg.group, a: acc, v: 0 });
    groups[groups.length - 1]!.v += sg.v;
    acc += sg.v;
  }
  for (const g of groups) {
    const y0 = y(g.a + g.v) + 2, y1 = y(g.a) - 2;
    if (y1 - y0 < 10) continue;
    svg.append(s("path", { class: "earmark-bracket", d: `M${brx} ${y0} h4 V${y1} h-4` }));
    svg.append(s("text", { x: brx + 10, y: (y0 + y1) / 2 - 2, class: "earmark-bold earmark-muted earmark-small" }, GROUP_NAMES[g.key] ?? g.key));
    svg.append(s("text", { x: brx + 10, y: (y0 + y1) / 2 + 11, class: "earmark-faint" }, `${T.income > 0 ? Math.round((g.v / T.income) * 100) : 0}%`));
  }
}
