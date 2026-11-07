import { ItemView, Menu, Notice, TFile } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { Entry, EntryPatch, EntryRef, Plan, Section, Sort, View } from "../core";
import {
  addEntry, formatAmount, formatRounded, freqLabel, moveEntry, parse, removeEntry, setMeta, shown, StaleError, totals, updateEntry
} from "../core";
import { drawChart, entryId } from "./chart";
import type { ColorOf } from "./colors";
import { colorMap } from "./colors";
import { h } from "./dom";
import type { Focus, ListHost } from "./list";
import { closePopover, renderList } from "./list";

export const VIEW_TYPE = "earmark-view";
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

export class EarmarkView extends ItemView implements ListHost {
  file: TFile | null = null;
  plan: Plan = parse("");
  view: View = "month";
  sort: Sort = "manual";
  hoverId: string | null = null;
  focusNext: Focus | null = null;
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
    return this.file ? this.file.basename : "Earmark";
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
        new Notice("Earmark: the note changed, so it was reloaded. Try again.");
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
    const undo = h("button", { class: "earmark-undo" }, "Undo");
    frag.append(h("span", {}, `Removed ${e.name} `), undo);
    const notice = new Notice(frag, 6000);
    undo.addEventListener("click", () => {
      notice.hide();
      void this.write((t) => {
        if (t === snap.after) return snap.before;
        new Notice("Earmark: the note changed since, so it can't be undone here.");
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

  private setMetaKey(key: "view" | "sort", value: string): void {
    if (key === "view") this.view = value as View;
    else this.sort = value as Sort;
    this.renderPlan();
    void this.write((t) => setMeta(t, key, value));
  }

  /* ---------- building the pane ---------- */

  private build(): void {
    const root = this.contentEl;
    root.replaceChildren();
    root.classList.add("earmark");

    const pick = h("button", { class: "earmark-pick", "aria-label": "Choose plan" });
    pick.addEventListener("click", (ev) => this.showPicker(ev));
    const viewCtl = this.segmented([["month", "Month"], ["year", "Year"]], (v) => this.setMetaKey("view", v));
    const tip = h("span", { class: "earmark-tipbox" });
    const info = h("button", { class: "earmark-info", "aria-label": "How amounts are shown" }, tip);
    const sortCtl = this.segmented([["manual", "As written"], ["amount", "Largest first"]], (v) => this.setMetaKey("sort", v));
    sortCtl.setAttribute("title", "Display order. The note keeps its own order.");
    root.append(h("div", { class: "earmark-head" }, pick, viewCtl, info, sortCtl));

    const list = h("div", { class: "earmark-list" });
    const chartBox = h("div", { class: "earmark-chartbox" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("earmark-chart");
    chartBox.append(svg);
    const metrics = h("div", { class: "earmark-metrics" });
    const tooltip = h("div", { class: "earmark-tooltip" });
    const chartCol = h("div", { class: "earmark-chartcol" }, chartBox, metrics, tooltip);
    const divider = h("div", { class: "earmark-divider", role: "separator", "aria-orientation": "vertical", title: "Drag to resize. Double-click to reset." });
    const body = h("div", { class: "earmark-body" }, list, divider, chartCol);
    this.setListWidth(this.host.listWidth);
    this.registerDomEvent(divider, "pointerdown", (ev) => this.startResize(ev, divider));
    this.registerDomEvent(divider, "dblclick", () => {
      this.setListWidth(undefined);
      this.host.saveListWidth(undefined);
    });
    const empty = h("div", { class: "earmark-empty" });
    root.append(body, empty);
    this.ui = { pick, viewCtl, sortCtl, tip, body, empty, list, chartBox, svg, metrics, tooltip };

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
      tooltip.classList.remove("is-shown");
      this.setHover(null);
    });
    this.registerDomEvent(chartBox, "click", (ev) => {
      const g = (ev.target as Element).closest(".earmark-seg");
      const id = g?.getAttribute("data-ids")?.split(" ")[0];
      const input = id ? list.querySelector<HTMLInputElement>(`.earmark-row[data-id="${id}"] .earmark-amount`) : null;
      if (input) {
        input.scrollIntoView({ block: "nearest" });
        input.focus();
        input.select();
      }
    });
  }

  private setListWidth(px: number | undefined): void {
    if (px === undefined) this.contentEl.style.removeProperty("--earmark-list-w");
    else this.contentEl.style.setProperty("--earmark-list-w", `${Math.round(px)}px`);
    this.ui?.list.querySelectorAll<HTMLInputElement>(".earmark-name").forEach((i) => i.dispatchEvent(new Event("input")));
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
    document.body.classList.add("earmark-resizing");
    const move = (m: PointerEvent) => {
      width = Math.max(min, Math.min(max(), from + m.clientX - start));
      this.setListWidth(width);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      divider.classList.remove("is-active");
      document.body.classList.remove("earmark-resizing");
      if (width !== from) this.host.saveListWidth(width <= min ? undefined : Math.round(width));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private segmented(options: Array<[string, string]>, onPick: (v: string) => void): HTMLElement {
    const el = h("div", { class: "earmark-segctl" });
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
    if (this.file) {
      const file = this.file;
      menu.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)));
    }
    menu.showAtMouseEvent(ev);
  }

  /* ---------- rendering ---------- */

  render(): void {
    if (!this.ui) return;
    const { pick, body, empty } = this.ui;
    pick.textContent = this.file ? this.plan.title ?? this.file.basename : "No plan";
    pick.append(h("span", { class: "earmark-caret" }, "▾"));
    const ready = !!this.file && this.plan.flagged;
    body.toggleAttribute("hidden", !ready);
    empty.toggleAttribute("hidden", ready);
    if (!ready) return this.renderEmpty();
    this.renderPlan();
  }

  private renderPlan(): void {
    const { viewCtl, sortCtl, tip, list } = this.ui;
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
      make.addEventListener("click", () => void this.write((t) => setMeta(t, "earmark", "1")));
      empty.append(h("p", {}, `${this.file.basename} isn't a plan yet. A plan has `, h("code", {}, "earmark: 1"), " in its frontmatter."), make);
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
    drawChart(this.ui.svg, { entries: this.plan.entries, totals: totals(this.plan.entries, this.view), view: this.view, sort: this.sort, uid: this.uid, colorOf: this.colorOf },
      box.clientWidth, box.clientHeight);
    this.applyHover();
  }

  private renderMetrics(): void {
    const t = totals(this.plan.entries, this.view);
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const metric = (value: string, label: string, neg = false) =>
      h("div", { class: `earmark-metric${neg ? " is-neg" : ""}` }, h("b", {}, value), h("span", {}, label));
    this.ui.metrics.replaceChildren(
      metric(formatRounded(t.cashLeft), `cash left over ${this.view === "month" ? "/mo" : "/y"}`, t.cashLeft < -0.5),
      metric(pct(t.taxRate), "tax rate"),
      metric(pct(t.savedRate), "saved, incl. shares & pension")
    );
  }

  setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.applyHover();
  }

  private applyHover(): void {
    if (!this.ui) return;
    const id = this.hoverId;
    this.ui.list.querySelectorAll<HTMLElement>(".earmark-row").forEach((r) => r.classList.toggle("is-hl", r.dataset.id === id));
    let any = false;
    this.ui.svg.querySelectorAll(".earmark-seg").forEach((g) => {
      const on = !!id && (g.getAttribute("data-ids") ?? "").split(" ").includes(id);
      any ||= on;
      g.classList.toggle("is-hl", on);
    });
    this.ui.svg.classList.toggle("is-dimming", any);
  }

  private onChartHover(ev: PointerEvent): void {
    const { tooltip, chartBox } = this.ui;
    const g = (ev.target as Element).closest(".earmark-seg");
    if (!g) {
      tooltip.classList.remove("is-shown");
      this.setHover(null);
      return;
    }
    const ids = (g.getAttribute("data-ids") ?? "").split(" ");
    const kind = g.getAttribute("data-kind");
    this.setHover(ids[0] ?? null);
    const t = totals(this.plan.entries, this.view);
    const per = this.view === "month" ? "/mo" : "/y";
    const line = (text: string, cls = "earmark-tt-sub") => h("div", { class: cls }, text);
    const parts: HTMLElement[] = [];
    if (kind === "unspent")
      parts.push(line("Kept as shares & pension", "earmark-tt-title"), line(`${formatRounded(t.unspent)}: shares and pension you receive and keep`), line("Saving that happens by itself, not spendable cash"));
    else if (kind === "left") parts.push(line("Cash left over", "earmark-tt-title"), line(`cash in ${formatRounded(t.cashIn)} − cash out ${formatRounded(t.cashOut)}`));
    else if (kind === "short")
      parts.push(line(`Cash shortfall ${formatRounded(t.cashLeft)}`, "earmark-tt-title is-error"), line(`cash out ${formatRounded(t.cashOut)} is more than cash in ${formatRounded(t.cashIn)}`), line("has to come from savings"));
    else {
      const es = ids.map((id) => this.plan.entries.find((e) => entryId(e) === id)).filter((e): e is Entry => !!e);
      if (es.length > 1) {
        parts.push(line(`${es.length} small items`, "earmark-tt-title"));
        for (const e of es) parts.push(line(`${e.name} ${formatRounded(shown(e, this.view))}`));
      } else if (es[0]) {
        const e = es[0];
        const conv = freqLabel(e.freq) === (this.view === "month" ? "monthly" : "yearly") ? "" : ` · ≈ ${formatRounded(shown(e, this.view))} ${per}`;
        parts.push(line(e.name, "earmark-tt-title"), line(`${formatAmount(e.amount, " ")} ${freqLabel(e.freq)}${conv}`));
        const share = t.income > 0 ? Math.round((shown(e, this.view) / t.income) * 100) : 0;
        const form = e.form === "cash" ? "" : e.section === "income" ? ` · ${e.form}` : " · paid in shares";
        parts.push(line(`${share}% of income${form}`));
      }
    }
    tooltip.replaceChildren(...parts);
    tooltip.classList.add("is-shown");
    const r = chartBox.parentElement!.getBoundingClientRect();
    const x = Math.min(ev.clientX - r.left + 14, r.width - tooltip.offsetWidth - 4);
    const y = Math.min(ev.clientY - r.top + 14, r.height - tooltip.offsetHeight - 4);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
}
