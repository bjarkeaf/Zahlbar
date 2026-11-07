import type { Entry, EntryPatch, Form, Freq, Plan, Section, Sort, View } from "../core";
import {
  formatAmount, formatRounded, freqLabel, MONTHLY, ordered, PALETTE, parseAmountInput, PRESETS, sameFreq,
  SECTION_TITLES, SECTIONS, shown, totals, UNITS, YEARLY
} from "../core";
import { entryId } from "./chart";
import type { ColorOf } from "./colors";
import { borderVar, fillVar } from "./colors";
import { h } from "./dom";

export interface Focus {
  line: number;
  field: "name" | "amount";
}

/** What the list needs from the view. Every edit goes through the view so it ends up in the note. */
export interface ListHost {
  plan: Plan;
  view: View;
  sort: Sort;
  hoverId: string | null;
  focusNext: Focus | null;
  colorOf: ColorOf;
  setHover(id: string | null): void;
  update(e: Entry, patch: EntryPatch, focus?: Focus | null): Promise<void>;
  remove(e: Entry): Promise<void>;
  add(section: Section): Promise<void>;
  /** adds a Saving line that takes `amount` out of shares or pension */
  addSale(form: "shares" | "pension", amount: number, freq: Freq | undefined): Promise<void>;
  previewMove(e: Entry, to: number): void;
  commitMove(e: Entry, to: number): Promise<void>;
  openLine(line: number): void;
}

const measure = document.createElement("canvas").getContext("2d");
/** Sizes the name field to its text, so the space after it stays free as a drag handle. */
function fitName(input: HTMLInputElement): void {
  if (!measure || !input.isConnected) return;
  const cs = getComputedStyle(input);
  measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  input.style.width = `${Math.ceil(measure.measureText(input.value || " ").width) + 12}px`;
}

const native = (view: View): Freq => (view === "month" ? MONTHLY : YEARLY);
const per = (view: View) => (view === "month" ? "/mo" : "/y");

export function renderList(root: HTMLElement, host: ListHost): void {
  closePopover();
  root.replaceChildren();
  root.classList.toggle("zahlbar-sorted", host.sort !== "manual");
  const { plan, view } = host;

  for (const sec of SECTIONS) {
    const list = ordered(plan.entries, sec, host.sort);
    const t = totals(plan.entries, view);
    // Saving also counts the shares and pension you receive, so the total matches the chart's Saving bracket
    const received = sec === "saving" ? t.sharesReceived + t.pensionReceived : 0;
    const total = list.filter((e) => !e.hidden).reduce((a, e) => a + shown(e, view), 0) + received;
    const box = h("div", { class: "zahlbar-sec" },
      h("div", { class: "zahlbar-sec-head" }, h("span", {}, SECTION_TITLES[sec]), h("span", {}, `${formatRounded(total)} ${view === "month" ? "per month" : "per year"}`)));
    for (const e of list) box.append(row(e, host));
    if (sec === "saving") {
      if (Math.abs(t.sharesReceived) > 0.5) box.append(receivedRow("shares", t.sharesReceived, host));
      if (Math.abs(t.pensionReceived) > 0.5) box.append(receivedRow("pension", t.pensionReceived, host));
    }
    const add = h("button", { class: "zahlbar-add" }, "+ Add");
    add.addEventListener("click", () => void host.add(sec));
    box.append(add);
    root.append(box);
  }

  if (plan.bad.length) {
    const foot = h("div", { class: "zahlbar-bad" }, `${plan.bad.length} ${plan.bad.length === 1 ? "line" : "lines"} not understood:`);
    for (const b of plan.bad) {
      const a = h("button", { class: "zahlbar-badline", title: `${b.reason}. Click to open the note at this line.` }, b.text);
      a.addEventListener("click", () => host.openLine(b.line));
      foot.append(a);
    }
    root.append(foot);
  }

  root.querySelectorAll<HTMLInputElement>(".zahlbar-name").forEach(fitName);
  // fonts may not have loaded on the first render
  requestAnimationFrame(() => root.querySelectorAll<HTMLInputElement>(".zahlbar-name").forEach(fitName));

  const f = host.focusNext;
  host.focusNext = null;
  if (f) {
    const el = root.querySelector<HTMLInputElement>(`.zahlbar-row[data-id="${f.line}"] .zahlbar-${f.field}`);
    if (el) {
      el.focus();
      el.select();
    }
  }
}

function row(e: Entry, host: ListHost): HTMLElement {
  const id = entryId(e);
  const c = host.colorOf(e);
  const r = h("div", { class: `zahlbar-row${e.hidden ? " is-off" : ""}${host.hoverId === id ? " is-hl" : ""}`, "data-id": id, "data-sec": e.section });

  const sw = h("button", {
    class: `zahlbar-sw${e.form === "shares" ? " is-lines" : e.form === "pension" ? " is-dots" : ""}`,
    style: `background-color:${fillVar(c)};border-color:${borderVar(c)}`,
    title: "Click: colour and type. Double-click: hide or show",
    "aria-label": `${e.name}: colour, type, hide`
  });
  let timer = 0;
  sw.addEventListener("click", (ev) => {
    ev.stopPropagation();
    window.clearTimeout(timer);
    // wait briefly so a double click can hide/show without flashing the popover open
    if (ev.detail >= 2) {
      closePopover();
      void host.update(e, { hidden: !e.hidden });
      return;
    }
    timer = window.setTimeout(() => openPopover(sw, e, host), ev.detail === 0 ? 0 : 220);
  });

  const name = h("input", { class: "zahlbar-name", value: e.name, spellcheck: "false", "aria-label": "Name" });
  name.addEventListener("input", () => fitName(name));
  editable(name, () => e.name, (v) => {
    const t = v.trim();
    return t && t !== e.name ? host.update(e, { name: t }, { line: e.line, field: "amount" }) : null;
  }, () => ({ line: e.line, field: "amount" }), host);

  const grip = h("span", { class: "zahlbar-grip", title: host.sort === "manual" ? "Drag to reorder" : "Switch to As written to reorder" });
  grip.addEventListener("pointerdown", (ev) => startDrag(ev, e, host));

  const amount = h("input", { class: "zahlbar-amount", value: formatAmount(e.amount, " "), spellcheck: "false", inputmode: "decimal", "aria-label": "Amount" });
  const nextFocus = (): Focus | null => {
    const same = ordered(host.plan.entries, e.section, host.sort);
    const next = same[same.indexOf(e) + 1];
    return next ? { line: next.line, field: "amount" } : null;
  };
  editable(amount, () => formatAmount(e.amount, " "), (v) => {
    const p = parseAmountInput(v);
    if (!p) {
      amount.classList.add("is-invalid");
      return null;
    }
    const patch: EntryPatch = {};
    if (p.amount !== e.amount) patch.amount = p.amount;
    if (p.freq && !sameFreq(p.freq, e.freq)) patch.freq = p.freq;
    return Object.keys(patch).length ? host.update(e, patch, nextFocus()) : null;
  }, nextFocus, host);

  const conv = sameFreq(e.freq, native(host.view)) ? null : h("span", { class: "zahlbar-conv" }, `≈ ${formatRounded(shown(e, host.view))} ${per(host.view)}`);
  const remove = h("button", { class: "zahlbar-x", title: "Remove", "aria-label": `Remove ${e.name}` }, "×");
  remove.addEventListener("click", () => void host.remove(e));

  r.append(sw, h("div", { class: "zahlbar-namecell" }, name, grip), h("div", { class: "zahlbar-amountcell" }, amount, conv), freqCell(e, host, r), remove);
  r.addEventListener("pointerenter", () => host.setHover(id));
  r.addEventListener("pointerleave", () => host.setHover(null));
  return r;
}

/** A computed row in Saving: shares or pension received from income. Not editable, but it can start a sale. */
function receivedRow(form: "shares" | "pension", value: number, host: ListHost): HTMLElement {
  const r = h("div", { class: "zahlbar-crow", "data-id": form, title: "Calculated from Income and Tax" });
  const action = form === "shares" ? "sell…" : "take out…";
  const btn = h("button", { class: "zahlbar-sell", "aria-label": form === "shares" ? "Sell some of these shares" : "Take out some pension" }, action);
  btn.addEventListener("click", () => openSale(btn, form, host));
  r.append(
    h("span", { class: `zahlbar-sw zahlbar-crow-sw ${form === "shares" ? "is-lines" : "is-dots"}` }),
    h("span", { class: "zahlbar-crow-name" }, form === "shares" ? "Shares received" : "Pension received"),
    h("span", { class: "zahlbar-crow-amount" }, formatRounded(value)),
    btn,
    h("span", {})
  );
  r.addEventListener("pointerenter", () => host.setHover(form));
  r.addEventListener("pointerleave", () => host.setHover(null));
  return r;
}

/** Shortcut for selling: an amount, and how often with the same dropdown as the rows (presets, or custom…). */
function openSale(anchor: HTMLElement, form: "shares" | "pension", host: ListHost): void {
  const amount = h("input", { class: "zahlbar-sale-amount", placeholder: "Amount", inputmode: "decimal", spellcheck: "false", "aria-label": "Amount" });
  const select = h("select", { class: "zahlbar-sale-freq dropdown", "aria-label": "How often" });
  PRESETS.forEach(([f, label], i) => select.append(h("option", { value: String(i), selected: sameFreq(f, MONTHLY) }, label)));
  select.append(h("option", { value: "custom" }, "custom…"));
  const n = h("input", { class: "zahlbar-freqn", type: "number", min: 1, step: 1, value: 1, "aria-label": "Every how many" });
  const unit = h("select", { class: "zahlbar-frequ", "aria-label": "Unit" });
  for (const u of UNITS) unit.append(h("option", { value: u, selected: u === "month" }, `${u}s`));
  const custom = h("div", { class: "zahlbar-custom zahlbar-sale-custom", hidden: true }, "every ", n, unit);
  select.addEventListener("change", () => {
    if (select.value !== "custom") return;
    select.hidden = true;
    custom.hidden = false;
    n.focus();
    n.select();
  });
  const el = h("div", { class: "zahlbar-pop zahlbar-sale" },
    h("div", { class: "zahlbar-pop-label" }, form === "shares" ? "Sell shares" : "Take out pension"), amount, select, custom);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") return closePopover();
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const a = parseAmountInput(amount.value);
    if (!a || a.amount === 0) return amount.classList.add("is-invalid");
    let freq: Freq;
    if (custom.hidden) freq = { ...(PRESETS[Number(select.value)]?.[0] ?? MONTHLY) };
    else {
      const count = Math.round(Number(n.value));
      if (!(count >= 1)) return n.classList.add("is-invalid");
      freq = { n: count, unit: unit.value as Freq["unit"] };
    }
    closePopover();
    void host.addSale(form, Math.abs(a.amount), freq);
  });
  mountPopover(el, anchor.getBoundingClientRect());
  amount.focus();
}

/** Enter commits and moves on, Esc reverts, leaving the field commits. */
function editable(input: HTMLInputElement, original: () => string, commit: (v: string) => Promise<void> | null, next: () => Focus | null, host: ListHost): void {
  let done = false;
  input.addEventListener("focus", () => (done = false));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      done = true;
      const p = commit(input.value);
      if (!p) {
        // nothing changed, just move on
        const f = next();
        const el = f && input.closest(".zahlbar-list")?.querySelector<HTMLInputElement>(`.zahlbar-row[data-id="${f.line}"] .zahlbar-${f.field}`);
        if (el) {
          el.focus();
          el.select();
        } else input.blur();
      }
    } else if (ev.key === "Escape") {
      done = true;
      input.value = original();
      input.blur();
    }
  });
  input.addEventListener("blur", () => {
    if (done) return;
    done = true;
    host.focusNext = null;
    if (commit(input.value) === null) input.value = original();
  });
}

function freqCell(e: Entry, host: ListHost, rowEl: HTMLElement): HTMLElement {
  const cell = h("div", { class: "zahlbar-freqcell" });
  const select = h("select", { class: "zahlbar-freq", "aria-label": "How often" });
  const presetIndex = PRESETS.findIndex(([f]) => sameFreq(f, e.freq));
  PRESETS.forEach(([, label], i) => select.append(h("option", { value: String(i), selected: i === presetIndex }, label)));
  if (presetIndex < 0) select.append(h("option", { value: "current", selected: true }, freqLabel(e.freq)));
  select.append(h("option", { value: "custom" }, "custom…"));
  select.addEventListener("change", () => {
    if (select.value === "custom") return openCustom(cell, e, host, rowEl);
    const preset = PRESETS[Number(select.value)];
    if (preset) void host.update(e, { freq: { ...preset[0] } });
  });
  cell.append(select);
  return cell;
}

/** "every [N] [days|weeks|months|years]" in place of the dropdown. */
function openCustom(cell: HTMLElement, e: Entry, host: ListHost, rowEl: HTMLElement): void {
  rowEl.classList.add("is-editing");
  const n = h("input", { class: "zahlbar-freqn", type: "number", min: 1, step: 1, value: e.freq.n, "aria-label": "Every how many" });
  const unit = h("select", { class: "zahlbar-frequ", "aria-label": "Unit" });
  for (const u of UNITS) unit.append(h("option", { value: u, selected: u === e.freq.unit }, `${u}s`));
  const box = h("span", { class: "zahlbar-custom" }, "every ", n, unit);
  let closed = false;
  const close = (save: boolean) => {
    if (closed) return;
    closed = true;
    const count = Math.round(Number(n.value));
    const freq: Freq = { n: count, unit: unit.value as Freq["unit"] };
    if (save && count >= 1 && !sameFreq(freq, e.freq)) void host.update(e, { freq });
    else {
      rowEl.classList.remove("is-editing");
      cell.replaceWith(freqCell(e, host, rowEl));
    }
  };
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      close(true);
    } else if (ev.key === "Escape") close(false);
  });
  box.addEventListener("focusout", (ev) => {
    const to = ev.relatedTarget as Node | null;
    if (!to || !box.contains(to)) window.setTimeout(() => close(true));
  });
  cell.replaceChildren(box);
  n.focus();
  n.select();
}

/* ---------- drag to reorder, from the free space after the name ---------- */

function startDrag(ev: PointerEvent, e: Entry, host: ListHost): void {
  if (host.sort !== "manual" || ev.button !== 0) return;
  ev.preventDefault();
  const list = (ev.target as HTMLElement).closest<HTMLElement>(".zahlbar-list");
  if (!list) return;
  const startY = ev.clientY;
  let active = false;
  let index = ordered(host.plan.entries, e.section, "manual").indexOf(e);
  const from = index;
  const id = entryId(e);

  const move = (m: PointerEvent) => {
    if (!active) {
      if (Math.abs(m.clientY - startY) < 4) return;
      active = true;
      document.body.classList.add("zahlbar-grabbing");
    }
    const rows = [...list.querySelectorAll<HTMLElement>(`.zahlbar-row[data-sec="${e.section}"]`)];
    const cur = rows.findIndex((r) => r.dataset.id === id);
    let to = rows.findIndex((r) => {
      const b = r.getBoundingClientRect();
      return m.clientY < b.top + b.height / 2;
    });
    if (to < 0) to = rows.length;
    if (to > cur) to -= 1;
    if (to === cur || cur < 0) return;
    index = to;
    host.previewMove(e, to);
    list.querySelector(`.zahlbar-row[data-id="${id}"]`)?.classList.add("is-dragging");
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    document.body.classList.remove("zahlbar-grabbing");
    if (active && index !== from) void host.commitMove(e, index);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/* ---------- swatch popover: colour, cash/shares/pension, hide ---------- */

let pop: HTMLElement | null = null;
let popCleanup: (() => void) | null = null;

export function closePopover(): void {
  popCleanup?.();
  popCleanup = null;
  pop?.remove();
  pop = null;
}

/** Applies an edit from the popover, then reopens it on the freshly parsed entry so it shows the new state. */
async function updateAndReopen(e: Entry, patch: EntryPatch, host: ListHost): Promise<void> {
  const line = e.line;
  await host.update(e, patch);
  const fresh = host.plan.entries.find((x) => x.line === line);
  const sw = document.querySelector<HTMLElement>(`.zahlbar-row[data-id="${line}"] .zahlbar-sw`);
  if (fresh && sw) openPopover(sw, fresh, host);
}

function openPopover(anchor: HTMLElement, e: Entry, host: ListHost): void {
  closePopover();
  const current = host.colorOf(e);
  const el = h("div", { class: "zahlbar-pop", role: "dialog", "aria-label": `${e.name} options` });
  const pal = h("div", { class: "zahlbar-pal" });
  PALETTE.forEach((name, i) => {
    const b = h("button", { class: i === current ? "is-on" : "", title: name, "aria-label": name, style: `background:${fillVar(i)};border-color:${borderVar(i)}` });
    b.addEventListener("click", () => {
      closePopover();
      void host.update(e, { color: name });
    });
    pal.append(b);
  });
  el.append(pal);
  if (!e.color) el.append(h("div", { class: "zahlbar-pop-note" }, "Automatic colour"));

  const forms: Array<[Form, string]> | null =
    e.section === "income" || e.section === "saving" ? [["cash", "Cash"], ["shares", "Shares"], ["pension", "Pension"]] : e.section === "tax" ? [["cash", "Cash"], ["shares", "Shares"]] : null;
  if (forms) {
    el.append(h("div", { class: "zahlbar-pop-sep" }), h("div", { class: "zahlbar-pop-label" }, e.section === "income" ? "Received as" : e.section === "saving" ? (e.amount < 0 ? "Comes out of" : "Goes into") : "Paid with"));
    const seg = h("div", { class: "zahlbar-segctl zahlbar-pop-forms" });
    for (const [f, label] of forms) {
      const b = h("button", { class: e.form === f ? "is-on" : "" }, label);
      b.addEventListener("click", () => {
        if (f !== e.form) void updateAndReopen(e, { form: f }, host);
      });
      seg.append(b);
    }
    el.append(seg);

    // on saving, the sign says which way the money goes: buying shares or selling them
    if (e.section === "saving") {
      const labels: Record<Form, [string, string]> = { shares: ["Buy", "Sell"], pension: ["Pay in", "Take out"], cash: ["Save", "Withdraw"] };
      const dir = h("div", { class: "zahlbar-segctl zahlbar-pop-forms zahlbar-pop-dir" });
      labels[e.form].forEach((label, i) => {
        const out = i === 1;
        const b = h("button", { class: (e.amount < 0) === out ? "is-on" : "" }, label);
        b.addEventListener("click", () => {
          if ((e.amount < 0) !== out && e.amount !== 0) void updateAndReopen(e, { amount: -e.amount }, host);
        });
        dir.append(b);
      });
      el.append(dir);
    }
  }

  const hide = h("button", { class: "zahlbar-pop-item" }, h("span", {}, e.hidden ? "Show" : "Hide"), h("span", { class: "zahlbar-pop-hint" }, "double-click"));
  hide.addEventListener("click", () => {
    closePopover();
    void host.update(e, { hidden: !e.hidden });
  });
  el.append(h("div", { class: "zahlbar-pop-sep" }), hide);

  mountPopover(el, anchor.getBoundingClientRect());
}

/** Shows `el` as the one open popover, below `at` (or above it when there's no room), closing on Esc or a click outside. */
export function mountPopover(el: HTMLElement, at: { left: number; top: number; bottom: number }, onClose?: () => void): void {
  closePopover();
  document.body.append(el);
  const height = el.offsetHeight;
  el.style.left = `${Math.max(4, Math.min(at.left, window.innerWidth - el.offsetWidth - 4))}px`;
  el.style.top = `${at.bottom + 6 + height > window.innerHeight ? Math.max(4, at.top - 6 - height) : at.bottom + 6}px`;
  pop = el;

  const outside = (ev: PointerEvent) => {
    if (!el.contains(ev.target as Node)) closePopover();
  };
  const esc = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closePopover();
  };
  window.setTimeout(() => document.addEventListener("pointerdown", outside, true));
  document.addEventListener("keydown", esc, true);
  popCleanup = () => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", esc, true);
    onClose?.();
  };
}
