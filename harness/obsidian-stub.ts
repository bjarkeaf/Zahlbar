// Minimal stand-in for the obsidian module, enough to run the real view in a browser page.
/* eslint-disable @typescript-eslint/no-explicit-any */
export class TFile {
  extension = "md";
  parent: { path: string } | null = { path: "" };
  constructor(public path: string) {}
  get basename(): string {
    return this.path.replace(/^.*\//, "").replace(/\.md$/, "");
  }
}

export class Component {
  private cleanups: Array<() => void> = [];
  registerEvent(_ref: unknown): void {}
  registerDomEvent(el: EventTarget, type: string, fn: (e: any) => void): void {
    el.addEventListener(type, fn);
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }
  register(fn: () => void): void {
    this.cleanups.push(fn);
  }
}

export class WorkspaceLeaf {}

export class ItemView extends Component {
  contentEl: HTMLElement = document.createElement("div");
  app: any = (window as any).__app;
  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.contentEl.className = "view-content";
  }
  getIcon(): string {
    return "";
  }
  getState(): Record<string, unknown> {
    return {};
  }
  async setState(_s: unknown, _r: unknown): Promise<void> {}
}

export class Plugin extends Component {}

export class Notice {
  el: HTMLElement;
  constructor(msg: string | DocumentFragment, _ms?: number) {
    this.el = document.createElement("div");
    this.el.className = "notice";
    this.el.append(msg);
    document.getElementById("notices")!.append(this.el);
  }
  hide(): void {
    this.el.remove();
  }
}

class MenuItem {
  el = document.createElement("div");
  constructor() {
    this.el.className = "menu-item";
  }
  setTitle(t: string) {
    this.el.prepend(t);
    return this;
  }
  setIcon(_i: string) {
    return this;
  }
  setChecked(c: boolean) {
    if (c) this.el.classList.add("is-checked");
    return this;
  }
  onClick(fn: () => void) {
    this.el.addEventListener("click", () => {
      document.querySelector(".menu")?.remove();
      fn();
    });
    return this;
  }
}

export class Menu {
  private el = document.createElement("div");
  constructor() {
    this.el.className = "menu";
  }
  addItem(cb: (i: MenuItem) => void) {
    const i = new MenuItem();
    cb(i);
    this.el.append(i.el);
    return this;
  }
  addSeparator() {
    this.el.append(Object.assign(document.createElement("div"), { className: "menu-separator" }));
    return this;
  }
  showAtMouseEvent(ev: MouseEvent) {
    this.el.style.cssText = `position:fixed;left:${ev.clientX}px;top:${ev.clientY}px`;
    document.body.append(this.el);
  }
}

export const normalizePath = (p: string): string => p.replace(/\/+/g, "/").replace(/^\//, "");
