import { normalizePath, Plugin, TFile } from "obsidian";
import { newPlanText } from "../core";
import type { ViewHost } from "./view";
import { EarmarkView, ICON, VIEW_TYPE } from "./view";

interface Prefs {
  lastFile?: string;
}

export default class EarmarkPlugin extends Plugin implements ViewHost {
  private prefs: Prefs = {};

  override async onload(): Promise<void> {
    this.prefs = ((await this.loadData()) as Prefs | null) ?? {};
    this.registerView(VIEW_TYPE, (leaf) => new EarmarkView(leaf, this));
    this.addRibbonIcon(ICON, "Open Earmark", () => void this.open());
    this.addCommand({ id: "open", name: "Open plan", callback: () => void this.open() });
    this.addCommand({ id: "new-plan", name: "New plan", callback: async () => this.openFile(await this.createPlan("")) });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && this.isPlan(file))
          menu.addItem((i) => i.setTitle("Open in Earmark").setIcon(ICON).onClick(() => void this.openFile(file)));
      })
    );
  }

  isPlan(file: TFile): boolean {
    return file.extension === "md" && this.app.metadataCache.getFileCache(file)?.frontmatter?.["earmark"] !== undefined;
  }

  planFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isPlan(f)).sort((a, b) => a.basename.localeCompare(b.basename));
  }

  rememberFile(path: string): void {
    if (this.prefs.lastFile === path) return;
    this.prefs.lastFile = path;
    void this.saveData(this.prefs);
  }

  /** Opens the active note if it's a plan, else the last plan, else the first one, else a new one. */
  async open(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const last = this.prefs.lastFile ? this.app.vault.getAbstractFileByPath(this.prefs.lastFile) : null;
    const pick =
      (active && this.isPlan(active) ? active : null) ??
      (last instanceof TFile && this.isPlan(last) ? last : null) ??
      this.planFiles()[0] ??
      (await this.createPlan(""));
    await this.openFile(pick);
  }

  async openFile(file: TFile): Promise<void> {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE).find((l) => l.view instanceof EarmarkView && l.view.file?.path === file.path);
    const leaf = existing ?? ws.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { file: file.path } });
    await ws.revealLeaf(leaf);
  }

  async createPlan(folder: string): Promise<TFile> {
    const base = folder && folder !== "/" ? `${folder}/` : "";
    let name = "Plan";
    for (let i = 2; this.app.vault.getAbstractFileByPath(normalizePath(`${base}${name}.md`)); i++) name = `Plan ${i}`;
    return this.app.vault.create(normalizePath(`${base}${name}.md`), newPlanText(name));
  }
}
