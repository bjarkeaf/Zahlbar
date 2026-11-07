// Drives the harness page in headless Chromium with real mouse and key input over CDP.
// usage: node harness/run.mjs [--only=edit,drag] [--shots] [--plan=note.md]   (--plan adds a screenshot of that note)   (CHROME=/path/to/chrome to override)
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
const profile = mkdtempSync(path.join(tmpdir(), "earmark-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--window-size=1300,820", "--no-first-run", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const example = readFileSync(path.join(here, "..", "examples", "Plan 2027.md"), "utf8");
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
const row = (name) => `.earmark-row:has(.earmark-name[value=${JSON.stringify(name)}])`;
const choose = (sel, value) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change", {bubbles: true})); })()`);
const metric = () => ev(`document.querySelector(".earmark-metric b").textContent`);
const names = (sec) => ev(`[...document.querySelectorAll('.earmark-row[data-sec="${sec}"] .earmark-name')].map(i => i.value)`);
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
    expect((await ev(`document.querySelectorAll(".earmark-row").length`)) === 18, "18 rows");
    expect((await metric()) === "3 050", `cash left 3 050, got ${await metric()}`);
    expect((await ev(`document.querySelectorAll(".earmark-seg").length`)) > 8, "chart has segments");
    expect((await ev(`[...document.querySelectorAll(".earmark-chart text")].some(t => t.textContent === "Outgoings")`)), "Outgoings title");
    expect((await ev(`document.querySelector(".earmark-pick").textContent`)).startsWith("Plan 2027"), "plan title in header");
  },
  async edit() {
    await boot();
    const before = await text();
    await fill(`${row("Rent")} .earmark-amount`, "10000");
    const after = await text();
    expect(after.includes("- Rent: 10 000\n"), "amount written");
    expect(before.split("\n").filter((l, i) => l !== after.split("\n")[i]).length === 1, "exactly one line changed");
    expect((await ev(`document.activeElement?.closest(".earmark-row")?.querySelector(".earmark-name")?.value`)) === "Car", "Enter moves to next row");
    await fill(`${row("Food")} .earmark-amount`, "120k yearly");
    expect((await text()).includes("- Food: 120 000 yearly\n"), "amount with frequency");
    await fill(`${row("Food")} .earmark-name`, "Groceries");
    expect((await text()).includes("- Groceries: 120 000 yearly\n"), "rename");
    await click(`${row("Leisure")} .earmark-amount`);
    await ev(`document.activeElement.select()`);
    await type("999");
    await key("Escape");
    await sleep(100);
    expect((await text()).includes("- Leisure: 4 500\n"), "Escape cancels");
    await fill(`${row("Leisure")} .earmark-amount`, "lots");
    expect((await text()).includes("- Leisure: 4 500\n"), "invalid amount not written");
  },
  async hide() {
    await boot();
    await dblclick(`${row("Food")} .earmark-sw`);
    await sleep(400);
    expect((await text()).includes("- ~~Food: 4 000~~\n"), "double-click hides");
    expect(!(await ev(`!!document.querySelector(".earmark-pop")`)), "no popover after double-click");
    await dblclick(`${row("Food")} .earmark-sw`);
    await sleep(400);
    expect((await text()).includes("- Food: 4 000\n"), "double-click shows again");
  },
  async popover() {
    await boot();
    await click(`${row("Rent")} .earmark-sw`);
    expect(!(await ev(`!!document.querySelector(".earmark-pop")`)), "popover waits for a possible double-click");
    await sleep(350);
    expect(await ev(`!!document.querySelector(".earmark-pop")`), "popover opens");
    await click(`.earmark-pop .earmark-pal button[title="rose"]`);
    await sleep(150);
    expect((await text()).includes("- Rent: 9 500 {rose}\n"), "colour written");
    await click(`${row("Tax on vest")} .earmark-sw`);
    await sleep(350);
    await click(`.earmark-pop-forms button:first-child`);
    await sleep(200);
    expect((await text()).includes("- Tax on vest: 12 000 quarterly\n"), "sell-to-cover switched off");
    expect((await metric()) === "−950", `cash left now −950, got ${await metric()}`);
    expect(await ev(`document.querySelector(".earmark-pop-forms .is-on")?.textContent === "Cash"`), "popover reopened with new state");
    await key("Escape");
    await sleep(50);
    expect(!(await ev(`!!document.querySelector(".earmark-pop")`)), "Escape closes popover");
    await click(`${row("Stock purchase plan")} .earmark-sw`);
    await sleep(350);
    expect((await ev(`document.querySelector(".earmark-pop-label")?.textContent`)) === "Goes into", "saving asks where the money goes");
    await click(`.earmark-pop-forms button:nth-child(2)`);
    await sleep(200);
    expect((await text()).includes("- Stock purchase plan: 5 000 {shares}\n"), "saving into shares written");
    expect((await metric()) === "−950", "cash unchanged by saving into shares");
    expect(await ev(`document.querySelector('${row("Stock purchase plan")} .earmark-sw').classList.contains("is-lines")`), "swatch shows lines");
    await key("Escape");
    await click(`${row("Salary")} .earmark-sw`);
    await sleep(350);
    await click(`.earmark-pop .earmark-pop-item`);
    await sleep(150);
    expect((await text()).includes("- ~~Salary: 50 000~~\n"), "hide from popover");
  },
  async frequency() {
    await boot();
    await choose(`${row("Rent")} .earmark-freq`, "2");
    await sleep(150);
    expect((await text()).includes("- Rent: 9 500 quarterly\n"), "preset");
    await choose(`${row("Food")} .earmark-freq`, "custom");
    await sleep(50);
    expect(await ev(`document.activeElement?.classList.contains("earmark-freqn")`), "custom editor focused");
    await ev(`document.activeElement.select()`);
    await type("6");
    await choose(`${row("Food")} .earmark-frequ`, "week");
    await click(`${row("Food")} .earmark-freqn`);
    await key("Enter");
    await sleep(150);
    expect((await text()).includes("- Food: 4 000 every 6 weeks\n"), "custom frequency");
    expect((await ev(`document.querySelector('${row("Food")} .earmark-freq').selectedOptions[0].textContent`)) === "every 6 weeks", "dropdown shows custom label");
  },
  async remove() {
    await boot();
    await hover(row("Leisure"));
    await click(`${row("Leisure")} .earmark-x`);
    await sleep(150);
    expect(!(await text()).includes("Leisure"), "removed");
    await click(`.notice .earmark-undo`);
    await sleep(150);
    expect((await text()) === example, "undo restores the note exactly");
  },
  async add() {
    await boot();
    await click(`.earmark-sec:nth-child(3) .earmark-add`);
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
    await drag(`${row("Food")} .earmark-grip`, row("Rent"));
    await sleep(200);
    const order = await fileNames("Living");
    expect(order[0] === "Food" && order[1] === "Rent", `Food moved above Rent in the note, got ${order.slice(0, 3)}`);
    expect((await names("living"))[0] === "Food", "list follows");
    await drag(`${row("Food")} .earmark-grip`, row("Glasses"), 28);
    await sleep(200);
    const order2 = await fileNames("Living");
    expect(order2[order2.length - 1] === "Food", `Food moved to the end, got ${order2.join(",")}`);
  },
  async sortAndView() {
    await boot();
    await click(`.earmark-head .earmark-segctl:last-of-type button[data-v="amount"]`);
    await sleep(150);
    expect((await text()).includes("sort: amount\n"), "sort saved in frontmatter");
    const living = await names("living");
    expect(living[0] === "Rent" && living[1] === "Leisure", `largest first, got ${living.slice(0, 3)}`);
    expect((await fileNames("Living"))[1] === "Car", "note keeps its order");
    expect(await ev(`getComputedStyle(document.querySelector(".earmark-grip"), "::after").display === "none"`), "no grip while sorted");
    await click(`.earmark-head .earmark-segctl button[data-v="year"]`);
    await sleep(150);
    expect((await text()).includes("view: year\n"), "view saved");
    expect((await metric()) === "36 600", `year metric 36 600, got ${await metric()}`);
  },
  async external() {
    await boot();
    await ev(`__em.external(${JSON.stringify(PLAN)}, __em.text(${JSON.stringify(PLAN)}).replace("- Rent: 9 500", "- Rent: 7 000"))`);
    await sleep(150);
    expect((await ev(`document.querySelector('${row("Rent")} .earmark-amount').value`)) === "7 000", "hand edit shows in pane");
    // the note changes without the pane noticing, then an edit aimed at the old line is refused
    await ev(`__em.external(${JSON.stringify(PLAN)}, __em.text(${JSON.stringify(PLAN)}).replace("- Rent: 7 000", "- Rent: 7 100"), true)`);
    await fill(`${row("Rent")} .earmark-amount`, "1");
    expect((await text()).includes("- Rent: 7 100\n"), "stale edit not written");
    expect(await ev(`[...document.querySelectorAll(".notice")].some(n => n.textContent.includes("changed"))`), "notice about reload");
    expect((await ev(`document.querySelector('${row("Rent")} .earmark-amount').value`)) === "7 100", "reloaded");
  },
  async resize() {
    await boot();
    const listW = () => ev(`Math.round(document.querySelector(".earmark-list").getBoundingClientRect().width)`);
    const nameW = () => ev(`Math.round(document.querySelector(".earmark-namecell").getBoundingClientRect().width)`);
    const w0 = await listW(), n0 = await nameW();
    const d = await point(".earmark-divider");
    await mouse("mouseMoved", d, { button: "none" });
    await mouse("mousePressed", d, { clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 5; i++) await mouse("mouseMoved", { x: d.x + i * 30, y: d.y }, { buttons: 1 });
    await mouse("mouseReleased", { x: d.x + 150, y: d.y }, { clickCount: 1 });
    await sleep(100);
    expect((await listW()) === w0 + 150, `list widened by 150, ${w0} -> ${await listW()}`);
    expect((await nameW()) === n0 + 150, "name column gets the extra space");
    expect((await ev(`__em.savedWidth`)) === w0 + 150, "width saved");
    const d1 = await point(".earmark-divider");
    await mouse("mouseMoved", d1, { button: "none" });
    await mouse("mousePressed", d1, { clickCount: 1, buttons: 1 });
    await mouse("mouseMoved", { x: d1.x - 300, y: d1.y }, { buttons: 1 });
    await mouse("mouseReleased", { x: d1.x - 300, y: d1.y }, { clickCount: 1 });
    await sleep(100);
    expect((await listW()) === w0, "can't go below the default width");
    const d2 = await point(".earmark-divider");
    await mouse("mousePressed", d2, { clickCount: 1, buttons: 1 });
    await mouse("mouseMoved", { x: 1290, y: d2.y }, { buttons: 1 });
    await mouse("mouseReleased", { x: 1290, y: d2.y }, { clickCount: 1 });
    await sleep(150);
    expect((await ev(`Math.round(document.querySelector(".earmark-chartcol").getBoundingClientRect().width)`)) >= 360, "chart keeps at least 360px");
    await dblclick(".earmark-divider");
    await sleep(100);
    expect((await listW()) === w0 && (await ev(`__em.savedWidth`)) === null, "double-click resets");
  },
  async badAndEmpty() {
    const bad = example.replace("- Food: 4 000", "- Food: 4 000\n- Gym: tbd");
    await boot({ [PLAN]: bad, "Notes.md": "# Notes\n" }, PLAN);
    expect((await ev(`document.querySelector(".earmark-badline")?.textContent`)) === "Gym: tbd", "bad line listed");
    await click(".earmark-badline");
    await sleep(50);
    const opened = await ev(`JSON.stringify(__em.opened)`);
    expect((await ev(`__em.opened.at(-1)?.line`)) === bad.split("\n").indexOf("- Gym: tbd"), `jumps to the line, opened ${opened}`);
    await boot({ "Notes.md": "# Notes\n" }, "Notes.md");
    expect(await ev(`document.querySelector(".earmark-empty").textContent.includes("isn't a plan")`), "explains a non-plan note");
    await click(".earmark-empty .mod-cta");
    await sleep(150);
    expect((await ev(`__em.text("Notes.md")`)).startsWith("---\nearmark: 1\n---\n"), "Make it a plan adds the flag");
    expect(await ev(`!document.querySelector(".earmark-body").hidden`), "plan view shown");
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
  if (args.plan) {
    await boot({ [PLAN]: readFileSync(args.plan, "utf8") });
    await shot("plan.png", 1300, 900);
  }
  console.log("screenshots in harness/dist/");
}

ws.close();
chrome.kill();
console.log(`\n${checks} checks, ${failures.length} failed`);
for (const f of failures) console.log("  " + f);
process.exit(failures.length ? 1 : 0);
