// Drives the harness page in headless Chromium with real mouse and key input over CDP.
// usage: node harness/run.mjs [--only=edit,drag] [--shots] [--docs] [--plan=note.md]   (--plan adds a screenshot of that note)   (CHROME=/path/to/chrome to override)
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const only = args.only ? args.only.split(",") : null;
const CHROME = process.env.CHROME ?? "chromium";
const PORT = 9400 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), "zahlbar-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1300,820", "--no-first-run", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const example = readFileSync(path.join(here, "..", "test", "fixtures", "Plan 2027.md"), "utf8");
const PLAN = "Plan 2027.md";

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("could not reach Chromium");
}
const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) pending.get(d.id)(d);
  if (d.method === "Runtime.exceptionThrown") pageErrors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") pageErrors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height}; })()`);
async function point(sel, dx, dy) {
  await ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: "nearest" })`);
  const r = await rect(sel);
  if (!r) throw new Error("missing " + sel);
  return { x: dx === undefined ? r.x + r.w / 2 : r.x + dx, y: dy === undefined ? r.y + r.h / 2 : r.y + dy };
}
const mouse = (type, p, extra = {}) => send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", ...extra });
async function click(sel, { dx, dy } = {}) {
  const p = await point(sel, dx, dy);
  await mouse("mouseMoved", p, { button: "none" });
  await mouse("mousePressed", p, { clickCount: 1, buttons: 1 });
  await mouse("mouseReleased", p, { clickCount: 1 });
}
async function dblclick(sel) {
  const p = await point(sel);
  await mouse("mouseMoved", p, { button: "none" });
  for (const n of [1, 2]) {
    await mouse("mousePressed", p, { clickCount: n, buttons: 1 });
    await mouse("mouseReleased", p, { clickCount: n });
  }
}
async function hover(sel) {
  await mouse("mouseMoved", await point(sel), { button: "none" });
}
async function drag(fromSel, toSel, toDy = 3) {
  await ev(`document.querySelector(${JSON.stringify(toSel)})?.scrollIntoView({ block: "nearest" })`);
  const ra = await rect(fromSel), rb = await rect(toSel);
  const a = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
  const b = { x: rb.x + rb.w / 2, y: rb.y + toDy };
  await mouse("mouseMoved", a, { button: "none" });
  await mouse("mousePressed", a, { clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++) {
    await mouse("mouseMoved", { x: a.x, y: a.y + ((b.y - a.y) * i) / 8 }, { buttons: 1 });
    await sleep(20);
  }
  await mouse("mouseReleased", b, { clickCount: 1 });
}
const KEYS = { Enter: 13, Escape: 27, Tab: 9 };
async function key(k) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: KEYS[k] });
}
const type = (text) => send("Input.insertText", { text });
/** click a field, replace its text, press Enter */
async function fill(sel, text) {
  await click(sel);
  await ev(`document.querySelector(${JSON.stringify(sel)}).select()`);
  await type(text);
  await key("Enter");
  await sleep(120);
}
const text = () => ev(`__em.text(${JSON.stringify(PLAN)})`);
const row = (name) => `.zahlbar-row:has(.zahlbar-name[value=${JSON.stringify(name)}])`;
const choose = (sel, value) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", {bubbles: true})); })()`);
const metric = () => ev(`document.querySelector(".zahlbar-metric b").textContent`);
const names = (sec) => ev(`[...document.querySelectorAll('.zahlbar-row[data-sec="${sec}"] .zahlbar-name')].map(i => i.value)`);
const fileNames = async (sec) => {
  const lines = (await text()).split("\n");
  const start = lines.indexOf(`## ${sec}`);
  const out = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("#"); i++) if (lines[i].startsWith("- ")) out.push(lines[i].replace(/^- (~~)?/, "").split(":")[0]);
  return out;
};

async function boot(fixtures = { [PLAN]: example }, open = PLAN, theme = "light") {
  await send("Page.navigate", { url: pathToFileURL(path.join(here, "page.html")).href });
  await sleep(300);
  await ev(`document.body.className = "theme-${theme}"`);
  await ev(`__em.boot(${JSON.stringify(fixtures)}, ${JSON.stringify(open)})`);
  await sleep(150);
}

const failures = [];
let checks = 0;
function expect(cond, msg) {
  checks++;
  if (!cond) failures.push(`${current}: ${msg}`);
}
let current = "";

const scenarios = {
  async render() {
    await boot();
    expect((await ev(`document.querySelectorAll(".zahlbar-row").length`)) === 18, "18 rows");
    expect((await metric()) === "3 050", `cash left 3 050, got ${await metric()}`);
    expect((await ev(`document.querySelectorAll(".zahlbar-seg").length`)) > 8, "chart has segments");
    expect((await ev(`[...document.querySelectorAll(".zahlbar-chart text")].some(t => t.textContent === "Outgoings")`)), "Outgoings title");
    expect((await ev(`document.querySelector(".zahlbar-pick").textContent`)).startsWith("Plan 2027"), "plan title in header");
    expect(await ev(`[...document.querySelectorAll(".zahlbar-chart text")].some(t => t.textContent === "64\u00a0500 DKK/mo")`), "currency on the income total");
    expect((await ev(`document.querySelector(".zahlbar-metric").textContent`)) === "Cash left over3\u00a0050DKK/mo", `metric reads label, value, unit, got ${await ev(`document.querySelector(".zahlbar-metric").textContent`)}`);
    const lit = () => ev(`[...document.querySelectorAll(".zahlbar-row.is-hl .zahlbar-name")].map(i => i.value).join(",")`);
    const grouphits = await ev(`document.querySelectorAll(".zahlbar-grouphit").length`);
    expect(grouphits >= 3, `group hover areas drawn, got ${grouphits}`);
    await hover(".zahlbar-grouphit");
    await sleep(60);
    expect((await lit()) === "Income tax,Tax on vest", `hovering the tax bracket lights the tax rows, got ${await lit()}`);
    expect((await ev(`document.querySelectorAll(".zahlbar-seg.is-hl").length`)) === 2, "and their segments");
    await hover(".zahlbar-metric:nth-child(2)");
    await sleep(60);
    expect((await lit()) === "Income tax,Tax on vest", `hovering Tax rate lights tax, got ${await lit()}`);
    await hover(".zahlbar-metric:nth-child(3)");
    await sleep(60);
    expect((await lit()).startsWith("Own pension,Stock purchase plan"), `hovering Saved lights saving, got ${await lit()}`);
    expect(await ev(`!!document.querySelector('.zahlbar-seg.is-hl[data-kind="left"]')`), "and cash left over");
    await mouse("mouseMoved", { x: 5, y: 5 }, { button: "none" });
    await sleep(60);
    expect((await lit()) === "", "clears on leave");
  },
  async edit() {
    await boot();
    const before = await text();
    await fill(`${row("Rent")} .zahlbar-amount`, "10000");
    const after = await text();
    expect(after.includes("- Rent: 10 000\n"), "amount written");
    expect(before.split("\n").filter((l, i) => l !== after.split("\n")[i]).length === 1, "exactly one line changed");
    expect((await ev(`document.activeElement?.closest(".zahlbar-row")?.querySelector(".zahlbar-name")?.value`)) === "Car", "Enter moves to next row");
    await fill(`${row("Food")} .zahlbar-amount`, "120k yearly");
    expect((await text()).includes("- Food: 120 000 yearly\n"), "amount with frequency");
    await fill(`${row("Food")} .zahlbar-name`, "Groceries");
    expect((await text()).includes("- Groceries: 120 000 yearly\n"), "rename");
    await click(`${row("Leisure")} .zahlbar-amount`);
    await ev(`document.activeElement.select()`);
    await type("999");
    await key("Escape");
    await sleep(100);
    expect((await text()).includes("- Leisure: 4 500\n"), "Escape cancels");
    await fill(`${row("Leisure")} .zahlbar-amount`, "lots");
    expect((await text()).includes("- Leisure: 4 500\n"), "invalid amount not written");
  },
  async hide() {
    await boot();
    await dblclick(`${row("Food")} .zahlbar-sw`);
    await sleep(400);
    expect((await text()).includes("- ~~Food: 4 000~~\n"), "double-click hides");
    expect(!(await ev(`!!document.querySelector(".zahlbar-pop")`)), "no popover after double-click");
    await dblclick(`${row("Food")} .zahlbar-sw`);
    await sleep(400);
    expect((await text()).includes("- Food: 4 000\n"), "double-click shows again");
  },
  async popover() {
    await boot();
    await click(`${row("Rent")} .zahlbar-sw`);
    expect(!(await ev(`!!document.querySelector(".zahlbar-pop")`)), "popover waits for a possible double-click");
    await sleep(350);
    expect(await ev(`!!document.querySelector(".zahlbar-pop")`), "popover opens");
    await click(`.zahlbar-pop .zahlbar-pal button[title="rose"]`);
    await sleep(150);
    expect((await text()).includes("- Rent: 9 500 {rose}\n"), "colour written");
    await click(`${row("Tax on vest")} .zahlbar-sw`);
    await sleep(350);
    await click(`.zahlbar-pop-forms button:first-child`);
    await sleep(200);
    expect((await text()).includes("- Tax on vest: 12 000 quarterly\n"), "sell-to-cover switched off");
    expect((await metric()) === "−950", `cash left now −950, got ${await metric()}`);
    expect(await ev(`document.querySelector(".zahlbar-pop-forms .is-on")?.textContent === "Cash"`), "popover reopened with new state");
    await key("Escape");
    await sleep(50);
    expect(!(await ev(`!!document.querySelector(".zahlbar-pop")`)), "Escape closes popover");
    await click(`${row("Stock purchase plan")} .zahlbar-sw`);
    await sleep(350);
    expect((await ev(`document.querySelector(".zahlbar-pop-label")?.textContent`)) === "Goes into", "saving asks where the money goes");
    await click(`.zahlbar-pop-forms button:nth-child(2)`);
    await sleep(200);
    expect((await text()).includes("- Stock purchase plan: 5 000 {shares}\n"), "saving into shares written");
    expect((await metric()) === "−950", "cash unchanged by saving into shares");
    expect(await ev(`document.querySelector('${row("Stock purchase plan")} .zahlbar-sw').classList.contains("is-lines")`), "swatch shows lines");
    await key("Escape");
    await click(`${row("Salary")} .zahlbar-sw`);
    await sleep(350);
    await click(`.zahlbar-pop .zahlbar-pop-item`);
    await sleep(150);
    expect((await text()).includes("- ~~Salary: 50 000~~\n"), "hide from popover");
  },
  async frequency() {
    await boot();
    await choose(`${row("Rent")} .zahlbar-freq`, "2");
    await sleep(150);
    expect((await text()).includes("- Rent: 9 500 quarterly\n"), "preset");
    await choose(`${row("Food")} .zahlbar-freq`, "custom");
    await sleep(50);
    expect(await ev(`document.activeElement?.classList.contains("zahlbar-freqn")`), "custom editor focused");
    await ev(`document.activeElement.select()`);
    await type("6");
    await choose(`${row("Food")} .zahlbar-frequ`, "week");
    await click(`${row("Food")} .zahlbar-freqn`);
    await key("Enter");
    await sleep(150);
    expect((await text()).includes("- Food: 4 000 every 6 weeks\n"), "custom frequency");
    expect((await ev(`document.querySelector('${row("Food")} .zahlbar-freq').selectedOptions[0].textContent`)) === "every 6 weeks", "dropdown shows custom label");
  },
  async breakdown() {
    await boot();
    const rowsIn = (sel) => ev(`[...document.querySelectorAll("${sel} .zahlbar-bd-row")].map(r => r.textContent)`);
    await hover(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    const hovered = await rowsIn(".zahlbar-tooltip");
    expect(JSON.stringify(hovered) === JSON.stringify(["+Stock vest10\u00a0000", "−Tax on vest4\u00a0000", "=Kept as shares6\u00a0000 DKK/mo"]), `hover shows breakdown, got ${JSON.stringify(hovered)}`);
    expect(await ev(`(() => { const id = __view.plan.entries.find((e) => e.name === "Stock vest").line; return document.querySelector('.zahlbar-seg[data-ids="' + id + '"]')?.classList.contains("is-hl"); })()`), "source lit up on hover");
    const box = (sel) => ev(`(() => { const b = document.querySelector("${sel}"); const r = b.getBoundingClientRect(); const rows = [...b.querySelectorAll(".zahlbar-bd-row")].map(x => Math.round(x.getBoundingClientRect().top - r.top)); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), rows }; })()`);
    const before = await box(".zahlbar-tooltip .zahlbar-breakdown");
    await click(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    expect(await ev(`!!document.querySelector(".zahlbar-pop.zahlbar-breakdown")`), "click freezes it");
    const after = await box(".zahlbar-pop.zahlbar-breakdown");
    expect(JSON.stringify(before) === JSON.stringify(after), `frozen looks exactly like hover: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
    await mouse("mouseMoved", { x: 5, y: 400 }, { button: "none" });
    await sleep(50);
    expect(await ev(`!!document.querySelector(".zahlbar-pop.zahlbar-breakdown")`), "stays open when the pointer leaves");
    await click(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    expect(!(await ev(`!!document.querySelector(".zahlbar-pop")`)), "clicking the segment again closes it, without reopening");
    await mouse("mouseMoved", { x: 5, y: 400 }, { button: "none" });
    await hover(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    const hov2 = await box(".zahlbar-tooltip .zahlbar-breakdown");
    await click(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    const frz2 = await box(".zahlbar-pop.zahlbar-breakdown");
    expect(hov2.x === frz2.x && hov2.y === frz2.y, `refreezes in place, ${JSON.stringify(hov2)} vs ${JSON.stringify(frz2)}`);
    await click(`.zahlbar-seg[data-kind="left"]`);
    await sleep(80);
    expect(!(await ev(`!!document.querySelector(".zahlbar-pop")`)), "clicking another segment while frozen just closes");
    await hover(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    await click(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    await click(`.zahlbar-pop .zahlbar-bd-row.is-link`);
    await sleep(100);
    expect((await ev(`document.activeElement?.closest(".zahlbar-row")?.querySelector(".zahlbar-name")?.value`)) === "Stock vest", "source line opens its amount for editing");
    expect(!(await ev(`!!document.querySelector(".zahlbar-pop")`)), "breakdown closes");
    await hover(`.zahlbar-seg[data-kind="left"]`);
    await sleep(80);
    const cash = await rowsIn(".zahlbar-tooltip");
    expect(cash.at(-1) === "=Cash left over3\u00a0050 DKK/mo" && cash.length === 6, `cash breakdown, got ${JSON.stringify(cash)}`);
  },
  async smallItems() {
    await boot();
    await hover(`.zahlbar-seg[data-kind="small"]`);
    await sleep(80);
    const rows = await ev(`[...document.querySelectorAll(".zahlbar-tooltip .zahlbar-bd-row")].map(r => r.textContent)`);
    expect(rows.length >= 3 && rows.slice(0, -1).every((r) => r.startsWith("+")) && /^=\d+ small items/.test(rows.at(-1)), `small items hover shows a breakdown, got ${JSON.stringify(rows)}`);
    await click(`.zahlbar-seg[data-kind="small"]`);
    await sleep(80);
    const first = await ev(`document.querySelector(".zahlbar-pop .zahlbar-bd-row.is-link .zahlbar-bd-label").textContent`);
    await click(`.zahlbar-pop .zahlbar-bd-row.is-link`);
    await sleep(100);
    expect((await ev(`document.activeElement?.closest(".zahlbar-row")?.querySelector(".zahlbar-name")?.value`)) === first, `clicking a line opens ${first} for editing`);
  },
  async sell() {
    await boot();
    await click(`.zahlbar-sec:nth-child(3) .zahlbar-add`);
    await sleep(150);
    await ev(`document.activeElement.select()`);
    await type("Sell shares");
    await key("Enter");
    await sleep(150);
    await ev(`document.activeElement.select()`);
    await type("-2000");
    await key("Enter");
    await sleep(150);
    expect((await text()).includes("- Sell shares: -2 000\n"), "negative saving written with ASCII minus");
    await click(`${row("Sell shares")} .zahlbar-sw`);
    await sleep(350);
    expect((await ev(`document.querySelector(".zahlbar-pop-label")?.textContent`)) === "Comes out of", "label for taking money out");
    await click(`.zahlbar-pop-forms button:nth-child(2)`);
    await sleep(200);
    await key("Escape");
    expect((await text()).includes("- Sell shares: -2 000 {shares}\n"), "sale from shares");
    await click(`${row("Sell shares")} .zahlbar-sw`);
    await sleep(350);
    expect((await ev(`[...document.querySelectorAll(".zahlbar-pop-dir button")].map(b => b.textContent + (b.classList.contains("is-on") ? "*" : "")).join(",")`)) === "Buy,Sell*", "Buy/Sell toggle shows Sell");
    await click(`.zahlbar-pop-dir button:first-child`);
    await sleep(200);
    expect((await text()).includes("- Sell shares: 2 000 {shares}\n"), "Buy flips the amount positive");
    expect((await ev(`document.querySelector(".zahlbar-pop-label")?.textContent`)) === "Goes into", "label follows");
    await click(`.zahlbar-pop-dir button:last-child`);
    await sleep(200);
    expect((await text()).includes("- Sell shares: -2 000 {shares}\n"), "Sell flips it back");
    await key("Escape");
    expect((await metric()) === "5\u00a0050", `cash left up by 2 000, got ${await metric()}`);
    await hover(`.zahlbar-seg[data-kind="shares"]`);
    await sleep(80);
    const rows = await ev(`[...document.querySelectorAll(".zahlbar-tooltip .zahlbar-bd-row")].map(r => r.textContent)`);
    expect(rows.includes("−Sell shares2\u00a0000") && rows.at(-1) === "=Kept as shares4\u00a0000 DKK/mo", `kept shares reduced, got ${JSON.stringify(rows)}`);
    await fill(`${row("Sell shares")} .zahlbar-amount`, "-9000");
    expect(await ev(`!!document.querySelector('.zahlbar-seg[data-kind="fromShares"]')`), "selling more than received draws on held shares");
  },
  async remove() {
    await boot();
    await hover(row("Leisure"));
    await click(`${row("Leisure")} .zahlbar-x`);
    await sleep(150);
    expect(!(await text()).includes("Leisure"), "removed");
    await click(`.notice .zahlbar-undo`);
    await sleep(150);
    expect((await text()) === example, "undo restores the note exactly");
  },
  async add() {
    await boot();
    await click(`.zahlbar-sec:nth-child(3) .zahlbar-add`);
    await sleep(150);
    expect((await text()).includes("- Stock purchase plan: 5 000\n- New entry: 0\n"), "added at end of Saving");
    expect((await ev(`document.activeElement?.value`)) === "New entry", "name focused");
    await ev(`document.activeElement.select()`);
    await type("Buffer");
    await key("Enter");
    await sleep(150);
    await ev(`document.activeElement.select()`);
    await type("1000");
    await key("Enter");
    await sleep(150);
    expect((await text()).includes("- Buffer: 1 000\n"), "named and priced via keyboard");
  },
  async drag() {
    await boot();
    await drag(`${row("Food")} .zahlbar-grip`, row("Rent"));
    await sleep(200);
    const order = await fileNames("Living");
    expect(order[0] === "Food" && order[1] === "Rent", `Food moved above Rent in the note, got ${order.slice(0, 3)}`);
    expect((await names("living"))[0] === "Food", "list follows");
    await drag(`${row("Food")} .zahlbar-grip`, row("Glasses"), 28);
    await sleep(200);
    const order2 = await fileNames("Living");
    expect(order2[order2.length - 1] === "Food", `Food moved to the end, got ${order2.join(",")}`);
  },
  async sortAndView() {
    await boot();
    await click(`.zahlbar-head .zahlbar-segctl:nth-of-type(2) button[data-v="amount"]`);
    await sleep(150);
    expect((await text()).includes("sort: amount\n"), "sort saved in frontmatter");
    const living = await names("living");
    expect(living[0] === "Rent" && living[1] === "Leisure", `largest first, got ${living.slice(0, 3)}`);
    expect((await fileNames("Living"))[1] === "Car", "note keeps its order");
    expect(await ev(`getComputedStyle(document.querySelector(".zahlbar-grip"), "::after").display === "none"`), "no grip while sorted");
    await click(`.zahlbar-head .zahlbar-segctl button[data-v="year"]`);
    await sleep(150);
    expect((await text()).includes("view: year\n"), "view saved");
    expect((await metric()) === "36 600", `year metric 36 600, got ${await metric()}`);
  },
  async scale() {
    await boot();
    expect((await ev(`[...document.querySelectorAll(".zahlbar-head .zahlbar-segctl:last-of-type button")].map(b => b.textContent).join(",")`)) === "DKK,%", "toggle labelled with the currency");
    await click(`.zahlbar-head .zahlbar-segctl:last-of-type button[data-v="percent"]`);
    await sleep(150);
    expect((await text()).includes("scale: percent\n"), "scale saved in frontmatter");
    const ticks = await ev(`[...document.querySelectorAll(".zahlbar-chart text.zahlbar-faint")].filter(t => +t.getAttribute("x") < 200).map(t => t.textContent)`);
    expect(ticks.length > 3 && ticks.every((t) => /^\d+%$/.test(t)), `axis in percent, got ${JSON.stringify(ticks)}`);
    expect(await ev(`[...document.querySelectorAll(".zahlbar-chart text")].some(t => t.textContent === "78%")`), "salary shown as 78% of income");
    await click(`.zahlbar-head .zahlbar-segctl:last-of-type button[data-v="amount"]`);
    await sleep(150);
    expect((await text()).includes("scale: amount\n"), "back to amounts");
  },
  async external() {
    await boot();
    await ev(`__em.external(${JSON.stringify(PLAN)}, __em.text(${JSON.stringify(PLAN)}).replace("- Rent: 9 500", "- Rent: 7 000"))`);
    await sleep(150);
    expect((await ev(`document.querySelector('${row("Rent")} .zahlbar-amount').value`)) === "7 000", "hand edit shows in pane");
    // the note changes without the pane noticing, then an edit aimed at the old line is refused
    await ev(`__em.external(${JSON.stringify(PLAN)}, __em.text(${JSON.stringify(PLAN)}).replace("- Rent: 7 000", "- Rent: 7 100"), true)`);
    await fill(`${row("Rent")} .zahlbar-amount`, "1");
    expect((await text()).includes("- Rent: 7 100\n"), "stale edit not written");
    expect(await ev(`[...document.querySelectorAll(".notice")].some(n => n.textContent.includes("changed"))`), "notice about reload");
    expect((await ev(`document.querySelector('${row("Rent")} .zahlbar-amount').value`)) === "7 100", "reloaded");
  },
  async resize() {
    await boot();
    const listW = () => ev(`Math.round(document.querySelector(".zahlbar-list").getBoundingClientRect().width)`);
    const nameW = () => ev(`Math.round(document.querySelector(".zahlbar-namecell").getBoundingClientRect().width)`);
    const w0 = await listW(), n0 = await nameW();
    const d = await point(".zahlbar-divider");
    await mouse("mouseMoved", d, { button: "none" });
    await mouse("mousePressed", d, { clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 5; i++) await mouse("mouseMoved", { x: d.x + i * 30, y: d.y }, { buttons: 1 });
    await mouse("mouseReleased", { x: d.x + 150, y: d.y }, { clickCount: 1 });
    await sleep(100);
    expect((await listW()) === w0 + 150, `list widened by 150, ${w0} -> ${await listW()}`);
    expect((await nameW()) === n0 + 150, "name column gets the extra space");
    expect((await ev(`__em.savedWidth`)) === w0 + 150, "width saved");
    const d1 = await point(".zahlbar-divider");
    await mouse("mouseMoved", d1, { button: "none" });
    await mouse("mousePressed", d1, { clickCount: 1, buttons: 1 });
    await mouse("mouseMoved", { x: d1.x - 300, y: d1.y }, { buttons: 1 });
    await mouse("mouseReleased", { x: d1.x - 300, y: d1.y }, { clickCount: 1 });
    await sleep(100);
    expect((await listW()) === w0, "can't go below the default width");
    const d2 = await point(".zahlbar-divider");
    await mouse("mousePressed", d2, { clickCount: 1, buttons: 1 });
    await mouse("mouseMoved", { x: 1290, y: d2.y }, { buttons: 1 });
    await mouse("mouseReleased", { x: 1290, y: d2.y }, { clickCount: 1 });
    await sleep(150);
    expect((await ev(`Math.round(document.querySelector(".zahlbar-chartcol").getBoundingClientRect().width)`)) >= 360, "chart keeps at least 360px");
    await dblclick(".zahlbar-divider");
    await sleep(100);
    expect((await listW()) === w0 && (await ev(`__em.savedWidth`)) === null, "double-click resets");
  },
  async tinyPlan() {
    await boot({ [PLAN]: "---\nzahlbar: 1\n---\n# Plan\n\n## Income\n- Salary: 0\n" });
    const ticks = await ev(`[...document.querySelectorAll(".zahlbar-chart text.zahlbar-faint")].map(t => t.textContent)`);
    expect(ticks.every((t) => /^(\d+(\.\d)?k?|\d+%|\d+ \/mo)$/.test(t)), `ticks are short, got ${JSON.stringify(ticks)}`);
    await fill(`${row("Salary")} .zahlbar-amount`, "0.3");
    const ticks2 = await ev(`[...document.querySelectorAll(".zahlbar-chart text.zahlbar-faint")].map(t => t.textContent)`);
    expect(ticks2.every((t) => !/\d{4,}/.test(t.replace("k", ""))), `no float noise, got ${JSON.stringify(ticks2)}`);
  },
  async badAndEmpty() {
    const bad = example.replace("- Food: 4 000", "- Food: 4 000\n- Gym: tbd");
    await boot({ [PLAN]: bad, "Notes.md": "# Notes\n" }, PLAN);
    expect((await ev(`document.querySelector(".zahlbar-badline")?.textContent`)) === "Gym: tbd", "bad line listed");
    await click(".zahlbar-badline");
    await sleep(50);
    const opened = await ev(`JSON.stringify(__em.opened)`);
    expect((await ev(`__em.opened.at(-1)?.line`)) === bad.split("\n").indexOf("- Gym: tbd"), `jumps to the line, opened ${opened}`);
    await boot({ "Notes.md": "# Notes\n" }, "Notes.md");
    expect(await ev(`document.querySelector(".zahlbar-empty").textContent.includes("isn't a plan")`), "explains a non-plan note");
    await click(".zahlbar-empty .mod-cta");
    await sleep(150);
    expect((await ev(`__em.text("Notes.md")`)).startsWith("---\nzahlbar: 1\n---\n"), "Make it a plan adds the flag");
    expect(await ev(`!document.querySelector(".zahlbar-body").hidden`), "plan view shown");
  }
};

for (const [name, fn] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  current = name;
  const errs = pageErrors.length;
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: threw ${e.message}`);
  }
  if (pageErrors.length > errs) failures.push(`${name}: page errors: ${pageErrors.slice(errs).join(" | ")}`);
  console.log(`${failures.some((f) => f.startsWith(name + ":")) ? "FAIL" : "ok  "} ${name}`);
}

if (args.shots) {
  mkdirSync(path.join(here, "dist"), { recursive: true });
  const shot = async (file, w, hgt) => {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(here, "dist", file), Buffer.from(r.result.data, "base64"));
  };
  await boot();
  await shot("light.png", 1300, 820);
  await boot({ [PLAN]: example.replace("- Rent: 9 500", "- Rent: 15 000") }, PLAN, "dark");
  await shot("dark-shortfall.png", 1300, 700);
  await boot();
  await shot("narrow.png", 600, 1100);
  if (args.docs) {
    const ex = readFileSync(path.join(here, "..", "examples", "Example plan.md"), "utf8");
    mkdirSync(path.join(here, "..", "docs"), { recursive: true });
    for (const theme of ["light", "dark"]) {
      await boot({ [PLAN]: ex }, PLAN, theme);
      await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 760, deviceScaleFactor: 2, mobile: false });
      await sleep(300);
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(here, "..", "docs", `screenshot-${theme}.png`), Buffer.from(r.result.data, "base64"));
    }
    console.log("docs screenshots in docs/");
  }
  if (args.plan) {
    await boot({ [PLAN]: readFileSync(args.plan, "utf8") });
    await shot("plan.png", 1300, 900);
    for (const kind of ["shares", "short"]) {
      if (!(await ev(`!!document.querySelector('.zahlbar-seg[data-kind="${kind}"]')`))) continue;
      await click(`.zahlbar-seg[data-kind="${kind}"]`);
      await sleep(150);
      await shot(`plan-${kind}.png`, 1300, 900);
      await key("Escape");
    }
  }
  console.log("screenshots in harness/dist/");
}

ws.close();
chrome.kill();
console.log(`\n${checks} checks, ${failures.length} failed`);
for (const f of failures) console.log("  " + f);
process.exit(failures.length ? 1 : 0);
