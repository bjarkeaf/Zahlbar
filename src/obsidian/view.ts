import { ItemView, Menu, Notice, TFile } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { Entry, EntryPatch, EntryRef, Freq, Plan, Scale, Section, Sort, View } from "../core";
import {
  addEntry, formatAmount, formatRounded, freqLabel, moveEntry, parse, removeEntry, setMeta, shown, StaleError, totals, updateEntry
} from "../core";
import { drawChart, entryId } from "./chart";
import type { ColorOf } from "./colors";
import { colorMap } from "./colors";
import { h } from "./dom";
import type { Focus, ListHost } from "./list";
import { closePopover, mountPopover, renderList } from "./list";

export const VIEW_TYPE = "zahlbar-view";
export const ICON = "piggy-bank";

/** What the view needs from the plugin. */
export interface ViewHost {
  planFiles(): TFile[];
  createPlan(folder: string): Promise<TFile>;
  rememberFile(path: string): void;
  /** list width in px chosen with the divider, shared by all panes */
  listWidth: number | undefined;
  saveListWidth(px: number | undefined): void;
}

const ref = (e: Entry): EntryRef => ({ line: e.line, raw: e.raw });

/** Segments Zahlbar computes rather than reads from a line. */
/** Segments explained by a breakdown: the computed ones, and "N small items" which lists what it merged. */
type Computed = "shares" | "pension" | "fromShares" | "fromPension" | "left" | "short" | "small";
const COMPUTED = ["shares", "pension", "fromShares", "fromPension", "left", "short", "small"];
const isComputed = (k: string | null | undefined): k is Computed => !!k && COMPUTED.includes(k);
const segIds = (g: Element | null | undefined): string[] => (g?.getAttribute("data-ids") ?? "").split(" ").filter((x) => x !== "");
interface BreakdownLine {
  sign: "+" | "−";
  label: string;
  value: number;
  e?: Entry;
  group?: Entry[];
}

export class ZahlbarView extends ItemView implements ListHost {
  file: TFile | null = null;
  plan: Plan = parse("");
  view: View = "month";
  sort: Sort = "manual";
  scale: Scale = "amount";
  hoverId: string | null = null;
  focusNext: Focus | null = null;
  /** segments to keep highlighted while a breakdown is open */
  private pinned: Set<string> | null = null;
  private frozen = false;
  /** segment ids per group (tax, saving, living, left, short) from the last chart draw */
  private groupIds: Record<string, string[]> = {};
  /** when the frozen breakdown was closed, so the click that closed it doesn't also open a new one */
  private unfrozenAt = 0;
  private pressClosed = false;
  colorOf: ColorOf = colorMap([]);

  private lastWritten: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  private reloadWhenIdle = false;
  private readonly uid = `em${Math.random().toString(36).slice(2, 8)}`;
  private resize: ResizeObserver | null = null;
  private ui!: {
    pick: HTMLButtonElement;
    viewCtl: HTMLElement;
    sortCtl: HTMLElement;
    scaleCtl: HTMLElement;
    tip: HTMLElement;
    body: HTMLElement;
    empty: HTMLElement;
    list: HTMLElement;
    chartBox: HTMLElement;
    svg: SVGSVGElement;
    metrics: HTMLElement;
    tooltip: HTMLElement;
  };

  constructor(leaf: WorkspaceLeaf, private readonly host: ViewHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return this.file ? this.file.basename : "Zahlbar";
  }
  override getIcon(): string {
    return ICON;
  }
  override getState(): Record<string, unknown> {
    return { file: this.file?.path ?? null };
  }
  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const path = (state as { file?: unknown } | null)?.file;
    if (typeof path === "string") {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.openFile(f);
    }
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    this.build();
    this.registerEvent(this.app.vault.on("modify", (f) => void this.onModify(f.path)));
    this.registerEvent(
      this.app.vault.on("rename", (f, old) => {
        if (this.file && old === this.file.path && f instanceof TFile) {
          this.file = f;
          this.host.rememberFile(f.path);
          this.render();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => {
        if (this.file && f.path === this.file.path) {
          this.file = null;
          this.plan = parse("");
          this.render();
        }
      })
    );
    this.render();
  }

  override async onClose(): Promise<void> {
    this.resize?.disconnect();
    closePopover();
  }

  async openFile(file: TFile): Promise<void> {
    this.file = file;
    this.host.rememberFile(file.path);
    this.lastWritten = null;
    this.loadText(await this.app.vault.read(file));
    // keep the tab title in sync with the plan
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }

  private loadText(text: string): void {
    this.plan = parse(text);
    this.colorOf = colorMap(this.plan.entries);
    this.view = this.plan.view;
    this.sort = this.plan.sort;
    this.scale = this.plan.scale;
    this.render();
  }

  private async onModify(path: string): Promise<void> {
    if (!this.file || path !== this.file.path) return;
    const text = await this.app.vault.read(this.file);
    if (text === this.lastWritten) return;
    if (this.isEditing()) {
      this.reloadWhenIdle = true;
      return;
    }
    this.loadText(text);
  }

  private isEditing(): boolean {
    const a = document.activeElement;
    return !!a && this.contentEl.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT");
  }

  /* ---------- writing to the note ---------- */

  /** Applies an edit to the note's current text, atomically, one at a time. */
  private write(op: (text: string) => string): Promise<void> {
    const file = this.file;
    if (!file) return Promise.resolve();
    const run = async () => {
      const result = { text: null as string | null };
      try {
        await this.app.vault.process(file, (data) => (result.text = op(data)));
      } catch (err) {
        if (!(err instanceof StaleError)) throw err;
        new Notice("Zahlbar: the note changed, so it was reloaded. Try again.");
        this.focusNext = null;
        this.loadText(await this.app.vault.read(file));
        return;
      }
      if (result.text !== null) {
        this.lastWritten = result.text;
        this.loadText(result.text);
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  update(e: Entry, patch: EntryPatch, focus: Focus | null = null): Promise<void> {
    this.focusNext = focus;
    return this.write((t) => updateEntry(t, ref(e), patch));
  }

  async remove(e: Entry): Promise<void> {
    const snap = { before: "", after: "" };
    await this.write((t) => {
      snap.before = t;
      return (snap.after = removeEntry(t, ref(e)));
    });
    const frag = document.createDocumentFragment();
    const undo = h("button", { class: "zahlbar-undo" }, "Undo");
    frag.append(h("span", {}, `Removed ${e.name} `), undo);
    const notice = new Notice(frag, 6000);
    undo.addEventListener("click", () => {
      notice.hide();
      void this.write((t) => {
        if (t === snap.after) return snap.before;
        new Notice("Zahlbar: the note changed since, so it can't be undone here.");
        return t;
      });
    });
  }

  add(section: Section): Promise<void> {
    return this.write((t) => {
      const r = addEntry(t, section, { name: "New entry", amount: 0 });
      this.focusNext = { line: r.line, field: "name" };
      return r.text;
    });
  }

  addSale(form: "shares" | "pension", amount: number, freq: Freq | undefined): Promise<void> {
    const name = form === "shares" ? "Sell shares" : "Pension payout";
    return this.write((t) => addEntry(t, "saving", { name, amount: -amount, form, ...(freq ? { freq } : {}) }).text);
  }

  /** Reorders in memory while dragging, so the list and chart follow the pointer. */
  previewMove(e: Entry, to: number): void {
    const entries = this.plan.entries;
    entries.splice(entries.indexOf(e), 1);
    const sec = entries.filter((x) => x.section === e.section);
    const at = to < sec.length ? entries.indexOf(sec[to]!) : entries.indexOf(sec[sec.length - 1]!) + 1;
    entries.splice(at, 0, e);
    this.renderPlan();
  }

  commitMove(e: Entry, to: number): Promise<void> {
    return this.write((t) => moveEntry(t, ref(e), to));
  }

  openLine(line: number): void {
    if (!this.file) return;
    void this.app.workspace.getLeaf("tab").openFile(this.file, { eState: { line } });
  }

  private setMetaKey(key: "view" | "sort" | "scale", value: string): void {
    if (key === "view") this.view = value as View;
    else if (key === "sort") this.sort = value as Sort;
    else this.scale = value as Scale;
    this.renderPlan();
    void this.write((t) => setMeta(t, key, value));
  }

  /* ---------- building the pane ---------- */

  private build(): void {
    const root = this.contentEl;
    root.replaceChildren();
    root.classList.add("zahlbar");

    const pick = h("button", { class: "zahlbar-pick", "aria-label": "Choose plan" });
    pick.addEventListener("click", (ev) => this.showPicker(ev));
    const viewCtl = this.segmented([["month", "Month"], ["year", "Year"]], (v) => this.setMetaKey("view", v));
    const tip = h("span", { class: "zahlbar-tipbox" });
    const info = h("button", { class: "zahlbar-info", "aria-label": "How amounts are shown" }, tip);
    const sortCtl = this.segmented([["manual", "As written"], ["amount", "Largest first"]], (v) => this.setMetaKey("sort", v));
    sortCtl.setAttribute("title", "Display order. The note keeps its own order.");
    // amounts or shares of income on the chart. The first button is labelled with the plan's currency.
    const scaleCtl = this.segmented([["amount", "Amount"], ["percent", "%"]], (v) => this.setMetaKey("scale", v));
    scaleCtl.setAttribute("title", "Show the chart in amounts or as % of income");
    root.append(h("div", { class: "zahlbar-head" }, pick, viewCtl, info, sortCtl, scaleCtl));

    const list = h("div", { class: "zahlbar-list" });
    const chartBox = h("div", { class: "zahlbar-chartbox" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("zahlbar-chart");
    chartBox.append(svg);
    const metrics = h("div", { class: "zahlbar-metrics" });
    const tooltip = h("div", { class: "zahlbar-tooltip" });
    const chartCol = h("div", { class: "zahlbar-chartcol" }, chartBox, metrics, tooltip);
    const divider = h("div", { class: "zahlbar-divider", role: "separator", "aria-orientation": "vertical", title: "Drag to resize. Double-click to reset." });
    const body = h("div", { class: "zahlbar-body" }, list, divider, chartCol);
    this.setListWidth(this.host.listWidth);
    this.registerDomEvent(divider, "pointerdown", (ev) => this.startResize(ev, divider));
    this.registerDomEvent(divider, "dblclick", () => {
      this.setListWidth(undefined);
      this.host.saveListWidth(undefined);
    });
    const empty = h("div", { class: "zahlbar-empty" });
    root.append(body, empty);
    this.ui = { pick, viewCtl, sortCtl, scaleCtl, tip, body, empty, list, chartBox, svg, metrics, tooltip };

    this.resize = new ResizeObserver(() => this.drawChart());
    this.resize.observe(chartBox);
    this.registerDomEvent(list, "focusout", () =>
      window.setTimeout(() => {
        if (this.reloadWhenIdle && !this.isEditing() && this.file) {
          this.reloadWhenIdle = false;
          void this.app.vault.read(this.file).then((t) => this.loadText(t));
        }
      })
    );
    this.registerDomEvent(chartBox, "pointermove", (ev) => this.onChartHover(ev));
    this.registerDomEvent(chartBox, "pointerleave", () => {
      if (this.frozen) return;
      tooltip.classList.remove("is-shown");
      this.pinned = null;
      this.setHover(null);
      this.applyHover();
    });
    // the document-level handler that closes popovers runs first, so here we can tell if this press closed one
    this.registerDomEvent(chartBox, "pointerdown", () => (this.pressClosed = Date.now() - this.unfrozenAt < 50));
    this.registerDomEvent(chartBox, "click", (ev) => {
      const g = (ev.target as Element).closest(".zahlbar-seg");
      const kind = g?.getAttribute("data-kind");
      // a click whose press closed a frozen breakdown only closes it
      if (this.pressClosed) return;
      if (isComputed(kind)) return this.freezeBreakdown(kind, ev, segIds(g));
      this.focusAmount(g?.getAttribute("data-ids")?.split(" ")[0]);
    });
  }

  private focusAmount(id: string | undefined): void {
    const input = id ? this.ui.list.querySelector<HTMLInputElement>(`.zahlbar-row[data-id="${id}"] .zahlbar-amount`) : null;
    if (!input) return;
    input.scrollIntoView({ block: "nearest" });
    input.focus();
    input.select();
  }

  /** Which lines feed into a computed segment, with + and −, and its total. */
  private breakdown(kind: Computed, ids: string[]): { title: string; total: number; lines: BreakdownLine[] } {
    if (kind === "small") {
      const es = ids.map((id) => this.plan.entries.find((e) => entryId(e) === id)).filter((e): e is Entry => !!e);
      const lines = es.map((e): BreakdownLine => ({ sign: "+", label: e.name, value: shown(e, this.view), e }));
      return { title: `${es.length} small items`, total: lines.reduce((a, l) => a + l.value, 0), lines };
    }
    const t = totals(this.plan.entries, this.view);
    const visible = this.plan.entries.filter((e) => !e.hidden);
    const plus = (e: Entry): BreakdownLine => ({ sign: "+", label: e.name, value: Math.abs(shown(e, this.view)), e });
    const minus = (e: Entry): BreakdownLine => ({ sign: "−", label: e.name, value: Math.abs(shown(e, this.view)), e });
    const pick = (section: Section, form?: Entry["form"]) => visible.filter((e) => e.section === section && (!form || e.form === form));
    const takenOut = (form?: Entry["form"]) => pick("saving", form).filter((e) => e.amount < 0);
    if (kind === "shares" || kind === "fromShares")
      return { title: kind === "shares" ? "Kept as shares" : "From shares you hold", total: t.keptShares,
        lines: [...pick("income", "shares").map(plus), ...pick("tax", "shares").map(minus), ...takenOut("shares").map(minus)] };
    if (kind === "pension" || kind === "fromPension")
      return { title: kind === "pension" ? "Kept as pension" : "From pension", total: t.keptPension, lines: [...pick("income", "pension").map(plus), ...takenOut("pension").map(minus)] };
    const group = (label: string, es: Entry[]): BreakdownLine[] =>
      es.length ? [{ sign: "−", label, value: es.reduce((a, e) => a + shown(e, this.view), 0), group: es }] : [];
    return {
      title: kind === "left" ? "Cash left over" : "Cash shortfall",
      total: t.cashLeft,
      lines: [...pick("income", "cash").map(plus), ...takenOut().map(plus), ...group("Tax paid in cash", pick("tax", "cash")),
        ...group("Savings", pick("saving").filter((e) => e.amount > 0)), ...group("Living", pick("living"))]
    };
  }

  private breakdownEl(kind: Computed, interactive: boolean, segIdsOf: string[] = []): { el: HTMLElement; ids: Set<string> } {
    const { title, total, lines } = this.breakdown(kind, segIdsOf);
    const per = this.unit();
    const row = (sign: string, label: string, value: string, cls = "") =>
      h("div", { class: `zahlbar-bd-row ${cls}` }, h("span", { class: "zahlbar-bd-sign" }, sign), h("span", { class: "zahlbar-bd-label" }, label), h("span", { class: "zahlbar-bd-value" }, value));
    const el = h("div", { class: "zahlbar-breakdown" }, h("div", { class: "zahlbar-bd-title" }, title));
    for (const l of lines) {
      const r = row(l.sign, l.label, formatRounded(l.value), l.e && interactive ? "is-link" : "");
      const e = l.e;
      if (e && interactive)
        r.addEventListener("click", () => {
          closePopover();
          this.focusAmount(entryId(e));
        });
      el.append(r);
    }
    el.append(row("=", title, `${formatRounded(total)} ${per}`, `zahlbar-bd-total${total < -0.5 ? " is-neg" : ""}`));
    return { el, ids: new Set([kind, ...lines.flatMap((l) => (l.e ? [l.e] : l.group ?? [])).map(entryId)]) };
  }

  /** Click on a computed segment: keep its breakdown open where the hover showed it, so a source line can be clicked. */
  private freezeBreakdown(kind: Computed, ev: MouseEvent, ids: string[]): void {
    const { tooltip } = this.ui;
    const at = tooltip.classList.contains("is-shown") ? tooltip.getBoundingClientRect() : null;
    tooltip.classList.remove("is-shown");
    const { el, ids: lit } = this.breakdownEl(kind, true, ids);
    el.classList.add("zahlbar-pop");
    this.frozen = true;
    this.pinned = lit;
    this.applyHover();
    const r = at ?? { left: ev.clientX + 14, top: ev.clientY + 14 };
    mountPopover(el, { left: r.left, top: r.top, bottom: r.top - 6 }, () => {
      this.frozen = false;
      this.unfrozenAt = Date.now();
      this.pinned = null;
      this.applyHover();
    });
  }

  private setListWidth(px: number | undefined): void {
    if (px === undefined) this.contentEl.style.removeProperty("--zahlbar-list-w");
    else this.contentEl.style.setProperty("--zahlbar-list-w", `${Math.round(px)}px`);
    this.ui?.list.querySelectorAll<HTMLInputElement>(".zahlbar-name").forEach((i) => i.dispatchEvent(new Event("input")));
  }

  /** Drags the divider between list and chart. The list can't go below its default width, and the chart keeps 360px. */
  private startResize(ev: PointerEvent, divider: HTMLElement): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const list = this.ui.list;
    const start = ev.clientX, from = list.getBoundingClientRect().width;
    const min = parseFloat(getComputedStyle(list).minWidth) || 460;
    const max = () => Math.max(min, this.ui.body.getBoundingClientRect().width - 360 - divider.offsetWidth);
    let width = from;
    divider.classList.add("is-active");
    document.body.classList.add("zahlbar-resizing");
    const move = (m: PointerEvent) => {
      width = Math.max(min, Math.min(max(), from + m.clientX - start));
      this.setListWidth(width);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      divider.classList.remove("is-active");
      document.body.classList.remove("zahlbar-resizing");
      if (width !== from) this.host.saveListWidth(width <= min ? undefined : Math.round(width));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private segmented(options: Array<[string, string]>, onPick: (v: string) => void): HTMLElement {
    const el = h("div", { class: "zahlbar-segctl" });
    for (const [value, label] of options) {
      const b = h("button", { "data-v": value }, label);
      b.addEventListener("click", () => onPick(value));
      el.append(b);
    }
    return el;
  }

  private showPicker(ev: MouseEvent): void {
    const menu = new Menu();
    for (const f of this.host.planFiles())
      menu.addItem((i) => i.setTitle(f.basename).setChecked(f.path === this.file?.path).onClick(() => void this.openFile(f)));
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle("New plan").setIcon("plus").onClick(async () => {
        const f = await this.host.createPlan(this.file?.parent?.path ?? "");
        await this.openFile(f);
      })
    );
    if (this.file && this.plan.flagged) {
      const current = this.plan.currency;
      menu.addItem((i) => i.setTitle(current ? `Currency: ${current}` : "Set currency").setIcon("coins").onClick(() => this.editCurrency()));
    }
    if (this.file) {
      const file = this.file;
      menu.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)));
    }
    menu.showAtMouseEvent(ev);
  }

  /** A small field by the scale toggle. Enter saves the currency to the note's frontmatter, empty removes it. */
  private editCurrency(): void {
    const input = h("input", { class: "zahlbar-currency-input", value: this.plan.currency ?? "", placeholder: "DKK, EUR, kr", spellcheck: "false", "aria-label": "Currency" });
    const el = h("div", { class: "zahlbar-pop zahlbar-currency" }, h("div", { class: "zahlbar-pop-label" }, "Currency"), input);
    let done = false;
    const save = () => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      closePopover();
      if (v !== (this.plan.currency ?? "")) void this.write((t) => setMeta(t, "currency", v));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      else if (e.key === "Escape") {
        done = true;
        closePopover();
      }
    });
    mountPopover(el, this.ui.scaleCtl.getBoundingClientRect());
    input.focus();
    input.select();
  }

  /* ---------- rendering ---------- */

  render(): void {
    if (!this.ui) return;
    const { pick, body, empty } = this.ui;
    // the file name identifies the plan, as in the tab and the plan menu. The note's heading is just text.
    pick.textContent = this.file ? this.file.basename : "No plan";
    pick.append(h("span", { class: "zahlbar-caret" }, "▾"));
    const ready = !!this.file && this.plan.flagged;
    body.toggleAttribute("hidden", !ready);
    empty.toggleAttribute("hidden", ready);
    if (!ready) return this.renderEmpty();
    this.renderPlan();
  }

  private renderPlan(): void {
    const { viewCtl, sortCtl, scaleCtl, tip, list } = this.ui;
    for (const b of Array.from(scaleCtl.children)) {
      b.classList.toggle("is-on", b.getAttribute("data-v") === this.scale);
      if (b.getAttribute("data-v") === "amount") b.textContent = this.plan.currency ?? "Amount";
    }
    for (const b of Array.from(viewCtl.children)) b.classList.toggle("is-on", b.getAttribute("data-v") === this.view);
    for (const b of Array.from(sortCtl.children)) b.classList.toggle("is-on", b.getAttribute("data-v") === this.sort);
    tip.textContent = this.view === "month"
      ? "Items that aren't monthly are averaged: 30 000 quarterly shows as 10 000 a month."
      : "Everything is shown per year: 4 000 monthly shows as 48 000.";
    renderList(list, this);
    this.drawChart();
    this.renderMetrics();
  }

  private renderEmpty(): void {
    const { empty } = this.ui;
    empty.replaceChildren();
    if (this.file && !this.plan.flagged) {
      const make = h("button", { class: "mod-cta" }, "Make it a plan");
      make.addEventListener("click", () => void this.write((t) => setMeta(t, "zahlbar", "1")));
      empty.append(h("p", {}, `${this.file.basename} isn't a plan yet. A plan has `, h("code", {}, "zahlbar: 1"), " in its frontmatter."), make);
      return;
    }
    const create = h("button", { class: "mod-cta" }, "New plan");
    create.addEventListener("click", async () => this.openFile(await this.host.createPlan("")));
    empty.append(h("p", {}, "No plan open."), create);
    for (const f of this.host.planFiles()) {
      const b = h("button", {}, `Open ${f.basename}`);
      b.addEventListener("click", () => void this.openFile(f));
      empty.append(b);
    }
  }

  private drawChart(): void {
    if (!this.ui || !this.file || !this.plan.flagged) return;
    const box = this.ui.chartBox;
    this.groupIds = drawChart(this.ui.svg, { entries: this.plan.entries, totals: totals(this.plan.entries, this.view), view: this.view, sort: this.sort, scale: this.scale, uid: this.uid, colorOf: this.colorOf, currency: this.plan.currency },
      box.clientWidth, box.clientHeight);
    this.applyHover();
  }

  private renderMetrics(): void {
    const t = totals(this.plan.entries, this.view);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const savings = t.income - t.tax - t.living - t.cashLeft;
    // label, value, unit, and the groups it counts, which light up on hover
    const metric = (label: string, value: string, unit: string, groups: string[], neg = false, title?: string): HTMLElement => {
      const el = h("div", { class: `zahlbar-metric${neg ? " is-neg" : ""}`, title },
        h("span", { class: "zahlbar-metric-label" }, label), h("b", {}, value), unit ? h("span", { class: "zahlbar-metric-unit" }, unit) : null);
      el.addEventListener("pointerenter", () => this.pinGroups(groups));
      el.addEventListener("pointerleave", () => this.pinGroups(null));
      return el;
    };
    this.ui.metrics.replaceChildren(
      // same order as the Outgoings bar, top down. All four add up to income.
      metric("Cash left over", formatRounded(t.cashLeft), this.unit(), ["left", "short"], t.cashLeft < -0.5),
      metric("Living", formatRounded(t.living), pct(t.income > 0 ? t.living / t.income : 0), ["living"]),
      // the Savings bracket: saving lines plus the shares and pension you keep
      metric("Savings", formatRounded(savings), pct(t.income > 0 ? savings / t.income : 0), ["saving"], false, "Including shares and pension you keep"),
      metric("Tax", formatRounded(t.tax), pct(t.taxRate), ["tax"])
    );
  }

  /** Highlights every segment and row in the given groups, or clears it. Ignored while a breakdown is frozen. */
  private pinGroups(groups: string[] | null): void {
    if (this.frozen) return;
    this.pinned = groups ? new Set(groups.flatMap((g) => this.groupIds[g] ?? [])) : null;
    this.applyHover();
  }

  /** "DKK/mo", or just "/mo" when the plan has no currency */
  private unit(): string {
    return `${this.plan.currency ?? ""}${this.view === "month" ? "/mo" : "/y"}`;
  }

  setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.applyHover();
  }

  private applyHover(): void {
    if (!this.ui) return;
    const id = this.hoverId;
    const pinned = this.pinned;
    const pinnedRows = this.pinned;
    this.ui.list.querySelectorAll<HTMLElement>(".zahlbar-row, .zahlbar-crow").forEach((r) =>
      r.classList.toggle("is-hl", pinnedRows ? pinnedRows.has(r.dataset.id ?? "") : r.dataset.id === id));
    let any = false;
    this.ui.svg.querySelectorAll(".zahlbar-seg").forEach((g) => {
      const ids = (g.getAttribute("data-ids") ?? "").split(" ");
      const on = pinned ? ids.some((x) => pinned.has(x)) : !!id && ids.includes(id);
      any ||= on;
      g.classList.toggle("is-hl", on);
    });
    this.ui.svg.classList.toggle("is-dimming", any);
  }

  private onChartHover(ev: PointerEvent): void {
    if (this.frozen) return;
    const { tooltip, chartBox } = this.ui;
    const hit = (ev.target as Element).closest(".zahlbar-grouphit");
    if (hit) {
      tooltip.classList.remove("is-shown");
      this.hoverId = null;
      this.pinned = new Set((hit.getAttribute("data-ids") ?? "").split(" "));
      this.applyHover();
      return;
    }
    const g = (ev.target as Element).closest(".zahlbar-seg");
    if (!g) {
      tooltip.classList.remove("is-shown");
      this.pinned = null;
      this.setHover(null);
      this.applyHover();
      return;
    }
    const ids = (g.getAttribute("data-ids") ?? "").split(" ");
    const kind = g.getAttribute("data-kind");
    this.setHover(ids[0] ?? null);
    const parts: HTMLElement[] = [];
    if (isComputed(kind)) {
      const b = this.breakdownEl(kind, false, ids);
      parts.push(b.el);
      this.pinned = b.ids;
    } else {
      this.pinned = null;
      const t = totals(this.plan.entries, this.view);
      const per = this.view === "month" ? "/mo" : "/y";
      const line = (text: string, cls = "zahlbar-tt-sub") => h("div", { class: cls }, text);
      const es = ids.map((id) => this.plan.entries.find((e) => entryId(e) === id)).filter((e): e is Entry => !!e);
      if (es.length > 1) {
        parts.push(line(`${es.length} small items`, "zahlbar-tt-title"));
        for (const e of es) parts.push(line(`${e.name} ${formatRounded(shown(e, this.view))}`));
      } else if (es[0]) {
        const e = es[0];
        const conv = freqLabel(e.freq) === (this.view === "month" ? "monthly" : "yearly") ? "" : ` · ≈ ${formatRounded(shown(e, this.view))} ${per}`;
        const share = t.income > 0 ? Math.round((Math.abs(shown(e, this.view)) / t.income) * 100) : 0;
        const dir = e.amount < 0 ? "from" : "into";
        const form = e.form === "cash" ? "" : e.section === "income" ? ` · ${e.form}` : e.section === "tax" ? " · paid in shares" : ` · ${dir} ${e.form}`;
        parts.push(line(e.name, "zahlbar-tt-title"), line(`${formatAmount(e.amount, "\u00a0")} ${freqLabel(e.freq)}${conv}`), line(`${share}% of income${form}`));
      }
    }
    this.applyHover();
    tooltip.replaceChildren(...parts);
    tooltip.classList.add("is-shown");
    const r = chartBox.parentElement!.getBoundingClientRect();
    const x = Math.min(ev.clientX - r.left + 14, r.width - tooltip.offsetWidth - 4);
    const y = Math.min(ev.clientY - r.top + 14, r.height - tooltip.offsetHeight - 4);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
}
