import type { Entry, Sort, Totals, View } from "../core";
import { formatRounded, formatTick, ordered, shown } from "../core";
import type { ColorOf } from "./colors";
import { borderVar, fillVar } from "./colors";
import { s } from "./dom";

/** Segments thinner than this (px) are merged with their thin neighbours into "N small items". */
const MIN_LABEL = 24;

const measureCtx = document.createElement("canvas").getContext("2d");
/** Width of a label in the chart's real font, so labels fit in any theme. Falls back to an estimate. */
function textWidth(text: string, px: number, bold: boolean, family: string): number {
  if (!measureCtx) return text.length * px * 0.55;
  measureCtx.font = `${bold ? 600 : 400} ${px}px ${family}`;
  return measureCtx.measureText(text).width;
}

export type Texture = "none" | "lines" | "dots";
export const textureOf = (form: Entry["form"]): Texture => (form === "shares" ? "lines" : form === "pension" ? "dots" : "none");
export type SegKind = "entry" | "small" | "shares" | "pension" | "fromShares" | "fromPension" | "left" | "short";
interface Seg {
  kind: SegKind;
  ids: string[];
  v: number;
  name: string;
  color: number;
  /** lines for shares, dots for pension, the same on both bars and in the list */
  texture: Texture;
  group: string;
}

export interface ChartInput {
  entries: Entry[];
  totals: Totals;
  view: View;
  sort: Sort;
  /** from the note's frontmatter, shown with totals only */
  currency: string | undefined;
  /** unique per view, so pattern ids don't clash between two open panes */
  uid: string;
  colorOf: ColorOf;
}

export const entryId = (e: Entry): string => String(e.line);

function niceStep(max: number, px: number): number {
  const n = Math.max(3, Math.min(10, Math.floor(px / 70)));
  const raw = max / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  // whole kroner at least, a fractional axis makes no sense for money
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
  return Math.max(1, 10 * p);
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
/** Draws both bars into `svg` at its real pixel size. Returns the segment ids in each group, for highlighting. */
export function drawChart(svg: SVGSVGElement, input: ChartInput, W: number, Hbox: number): Record<string, string[]> {
  svg.replaceChildren();
  if (W < 120 || Hbox < 120) return {};
  const { totals: T, view, uid } = input;
  const visible = input.entries.filter((e) => !e.hidden);
  const toSeg = (e: Entry): Seg => ({ kind: "entry", ids: [entryId(e)], v: shown(e, view), name: e.name, color: input.colorOf(e), texture: textureOf(e.form), group: e.section });

  let s1 = ordered(visible, "income", input.sort).map(toSeg);
  // shares and pension you keep are saving, so they sit in the Saving group. They're separate because
  // shares can be sold within months while pension is locked for decades.
  const kept: Seg[] = [];
  if (T.keptShares > 0.5) kept.push({ kind: "shares", ids: ["shares"], v: T.keptShares, name: "Kept as shares", color: 0, texture: "lines", group: "saving" });
  if (T.keptPension > 0.5) kept.push({ kind: "pension", ids: ["pension"], v: T.keptPension, name: "Kept as pension", color: 0, texture: "dots", group: "saving" });
  let s2 = [
    ...ordered(visible, "tax", input.sort).map(toSeg),
    ...ordered(visible, "saving", input.sort).map(toSeg),
    ...kept,
    ...ordered(visible, "living", input.sort).map(toSeg)
  ];
  if (T.cashLeft > 0.5) s2.push({ kind: "left", ids: ["left"], v: T.cashLeft, name: "Cash left over", color: 0, texture: "none", group: "left" });
  // selling more than you receive draws on what you already hold, shown as a source on top of Income
  if (T.keptShares < -0.5) s1.push({ kind: "fromShares", ids: ["fromShares"], v: -T.keptShares, name: "From shares you hold", color: 0, texture: "lines", group: "from" });
  if (T.keptPension < -0.5) s1.push({ kind: "fromPension", ids: ["fromPension"], v: -T.keptPension, name: "From pension", color: 0, texture: "dots", group: "from" });
  if (T.cashLeft < -0.5) s1.push({ kind: "short", ids: ["short"], v: -T.cashLeft, name: "Shortfall", color: 0, texture: "lines", group: "short" });
  s1 = s1.filter((x) => x.v > 0);
  s2 = s2.filter((x) => x.v > 0);

  const top = 22, bottom = Hbox - 40, H = bottom - top;
  const bw = Math.max(80, Math.min(180, W / 4.2));
  const gap = Math.max(32, Math.min(140, W * 0.13));
  // lay out from the axis labels to the % labels, then centre that block in the available width
  const content = 40 + 16 + bw + gap + bw + 8 + 130;
  const axL = 40 + Math.max(0, (W - content) / 2);
  const b1x = axL + 16, b2x = b1x + bw + gap, brx = b2x + bw + 8;
  const pctX = Math.min(W, brx + 130);
  const pctAxis = pctX - 42;
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
  const dots = (id: string, bg: string | null, dot: string) =>
    s("pattern", { id, patternUnits: "userSpaceOnUse", width: 6, height: 6 },
      bg ? s("rect", { width: 6, height: 6, style: `fill:${bg}` }) : null,
      s("circle", { cx: 3, cy: 3, r: 1.1, style: `fill:${dot}` }));
  for (let i = 0; i < 10; i++) defs.append(hatch(`${uid}-h${i}`, fillVar(i), borderVar(i)), dots(`${uid}-d${i}`, fillVar(i), borderVar(i)));
  defs.append(hatch(`${uid}-hn`, null, "var(--zahlbar-neutral-b)", 1), hatch(`${uid}-he`, null, "var(--text-error)", 0.55));
  defs.append(dots(`${uid}-hp`, null, "var(--zahlbar-neutral-b)"));
  svg.append(defs);

  // index × step rather than repeated addition, which drifts (0.1 + 0.2 = 0.30000000000000004)
  for (let i = 0, v = 0; v <= axisMax + step / 2; i++, v = i * step) {
    svg.append(s("line", { class: "zahlbar-grid", x1: axL, x2: brx + 4, y1: y(v), y2: y(v) }));
    svg.append(s("text", { class: "zahlbar-faint", x: axL - 6, y: y(v) + 4, "text-anchor": "end" }, formatTick(v)));
  }
  if (T.income > 0) {
    // the % scale doesn't line up with the kr grid, so it gets its own axis line and short ticks instead of gridlines
    const pctTop = Math.floor((axisMax / T.income) * 4) * 25;
    svg.append(s("line", { class: "zahlbar-axis", x1: pctAxis, x2: pctAxis, y1: y(0), y2: y((pctTop / 100) * T.income) }));
    for (let p = 0; p <= pctTop; p += 25) {
      const py = y((p / 100) * T.income);
      svg.append(s("line", { class: "zahlbar-axis", x1: pctAxis, x2: pctAxis + 5, y1: py, y2: py }));
      svg.append(s("text", { class: p === 100 ? "zahlbar-bold zahlbar-small" : "zahlbar-faint", x: pctX, y: py + 4, "text-anchor": "end" }, `${p}%`));
    }
    svg.append(s("line", { class: "zahlbar-ref", x1: axL, x2: pctAxis, y1: y(T.income), y2: y(T.income) }));
  }

  const per = `${input.currency ?? ""}${view === "month" ? "/mo" : "/y"}`;
  const title = (x: number, name: string, sub: string) => {
    svg.append(s("text", { class: "zahlbar-bold zahlbar-title", x: x + bw / 2, y: bottom + 20, "text-anchor": "middle" }, name));
    svg.append(s("text", { class: "zahlbar-faint", x: x + bw / 2, y: bottom + 36, "text-anchor": "middle" }, sub));
  };
  title(b1x, "Income", `${formatRounded(T.income)} ${per}`);
  // money taken out of saving isn't spending less, so the title only counts what goes out
  const goingOut = visible.filter((e) => e.section !== "income" && e.amount > 0).reduce((a, e) => a + shown(e, view), 0);
  title(b2x, "Outgoings", `${formatRounded(goingOut)} ${per}`);

  const family = getComputedStyle(svg).getPropertyValue("--font-interface").trim() || getComputedStyle(svg).fontFamily || "sans-serif";
  const width = (t: string, px = 13, bold = false) => textWidth(t, px, bold, family);
  const fits = (t: string, px = 13) => width(t, px) < bw - 12;
  const bar = (segs: Seg[], x: number) => {
    let acc = 0;
    for (const sg of segs) {
      const yt = y(acc + sg.v), h = sg.v * k, gy = yt + 1, gh = Math.max(h - 2, 0.8), r = Math.min(6, gh / 2);
      acc += sg.v;
      let fill: string, stroke: string, dash: string | undefined;
      if (sg.kind === "shares" || sg.kind === "fromShares") [fill, stroke] = [`url(#${uid}-hn)`, "var(--zahlbar-neutral-b)"];
      else if (sg.kind === "pension" || sg.kind === "fromPension") [fill, stroke] = [`url(#${uid}-hp)`, "var(--zahlbar-neutral-b)"];
      else if (sg.kind === "left") [fill, stroke, dash] = ["transparent", "var(--zahlbar-neutral-b)", "4 3"];
      else if (sg.kind === "short") [fill, stroke, dash] = [`url(#${uid}-he)`, "var(--text-error)", "4 3"];
      else if (sg.kind === "small") [fill, stroke] = ["var(--zahlbar-neutral)", "var(--zahlbar-neutral-b)"];
      else {
        const pattern = sg.texture === "lines" ? `url(#${uid}-h${sg.color})` : sg.texture === "dots" ? `url(#${uid}-d${sg.color})` : fillVar(sg.color);
        [fill, stroke] = [pattern, borderVar(sg.color)];
      }
      const g = s("g", { class: "zahlbar-seg", "data-ids": sg.ids.join(" "), "data-kind": sg.kind });
      g.append(s("rect", { x, y: gy, width: bw, height: gh, rx: r, style: `fill:${fill};stroke:${stroke}`, "stroke-dasharray": dash }));
      const cx = x + bw / 2;
      const pct = T.income > 0 ? Math.round((sg.v / T.income) * 100) : 0;
      const err = sg.kind === "short" ? "zahlbar-error" : "";
      const plate = sg.texture !== "none";
      if (gh >= 56 && fits(sg.name)) {
        const pw = Math.min(bw - 8, Math.max(width(sg.name), width(formatRounded(sg.v), 13, true), 50) + 16);
        if (plate) g.append(s("rect", { class: "zahlbar-plate", x: cx - pw / 2, y: gy + gh / 2 - 27, width: pw, height: 54, rx: 4 }));
        g.append(s("text", { x: cx, y: gy + gh / 2 - 9, "text-anchor": "middle", class: err }, sg.name));
        g.append(s("text", { x: cx, y: gy + gh / 2 + 8, "text-anchor": "middle", class: `zahlbar-bold ${err}` }, formatRounded(sg.v)));
        g.append(s("text", { x: cx, y: gy + gh / 2 + 23, "text-anchor": "middle", class: "zahlbar-faint" }, `${pct}%`));
      } else if (gh >= 20) {
        let t = `${sg.name} ${formatRounded(sg.v)}`;
        if (!fits(t, 12.5)) t = fits(sg.name, 12.5) ? sg.name : formatRounded(sg.v);
        const tw = width(t, 12.5);
        if (plate) g.append(s("rect", { class: "zahlbar-plate", x: cx - tw / 2 - 6, y: gy + gh / 2 - 9, width: tw + 12, height: 18, rx: 4 }));
        g.append(s("text", { x: cx, y: gy + gh / 2 + 4.5, "text-anchor": "middle", class: `zahlbar-small ${err}` }, t));
      }
      svg.append(g);
    }
  };
  bar(s1, b1x);
  bar(s2, b2x);
  if (T.cashLeft < -0.5)
    svg.append(s("text", { x: b1x + bw / 2, y: y(T1) - 6, "text-anchor": "middle", class: "zahlbar-bold zahlbar-error zahlbar-small" }, `${formatRounded(-T.cashLeft)} short`));

  // brackets marking the groups on the Outgoings bar
  let acc = 0;
  const groups: Array<{ key: string; a: number; v: number; ids: string[] }> = [];
  for (const sg of s2) {
    const last = groups[groups.length - 1];
    if (!last || last.key !== sg.group) groups.push({ key: sg.group, a: acc, v: 0, ids: [] });
    groups[groups.length - 1]!.v += sg.v;
    groups[groups.length - 1]!.ids.push(...sg.ids);
    acc += sg.v;
  }
  for (const g of groups) {
    const y0 = y(g.a + g.v) + 2, y1 = y(g.a) - 2;
    if (y1 - y0 < 10) continue;
    // the area right of the bar, around the bracket and its label, highlights the whole group on hover
    svg.append(s("rect", { class: "zahlbar-grouphit", x: b2x + bw + 2, y: y0 - 1, width: Math.max(0, pctAxis - 6 - (b2x + bw + 2)), height: y1 - y0 + 2, "data-ids": g.ids.join(" ") }));
    svg.append(s("path", { class: "zahlbar-bracket", d: `M${brx} ${y0} h4 V${y1} h-4` }));
    svg.append(s("text", { x: brx + 10, y: (y0 + y1) / 2 - 2, class: "zahlbar-bold zahlbar-small" }, GROUP_NAMES[g.key] ?? g.key));
    svg.append(s("text", { x: brx + 10, y: (y0 + y1) / 2 + 13, class: "zahlbar-faint" }, `${T.income > 0 ? Math.round((g.v / T.income) * 100) : 0}%`));
  }
  const out: Record<string, string[]> = {};
  for (const g of groups) out[g.key] = g.ids;
  if (T.cashLeft < -0.5) out["short"] = ["short"];
  return out;
}
