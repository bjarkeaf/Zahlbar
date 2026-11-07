// Boots the real ZahlbarView on an in-memory vault. run.mjs drives it with real input over CDP.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse } from "../src/core";
import { TFile } from "./obsidian-stub";

type Listener = (...a: any[]) => void;
const files = new Map<string, string>();
const fileObjs = new Map<string, TFile>();
const listeners: Record<string, Listener[]> = {};
const emit = (name: string, ...a: any[]) => setTimeout(() => (listeners[name] ?? []).forEach((l) => l(...a)), 0);
const opened: Array<{ path: string; line?: number }> = [];

const fileFor = (path: string) => {
  let f = fileObjs.get(path);
  if (!f) fileObjs.set(path, (f = new TFile(path)));
  return f;
};

const vault = {
  read: async (f: TFile) => files.get(f.path) ?? "",
  cachedRead: async (f: TFile) => files.get(f.path) ?? "",
  async process(f: TFile, fn: (t: string) => string) {
    const out = fn(files.get(f.path) ?? "");
    files.set(f.path, out);
    emit("modify", f);
    return out;
  },
  on(name: string, cb: Listener) {
    (listeners[name] ??= []).push(cb);
    return {};
  },
  getAbstractFileByPath: (p: string) => (files.has(p) ? fileFor(p) : null),
  getMarkdownFiles: () => [...files.keys()].map(fileFor),
  async create(path: string, text: string) {
    files.set(path, text);
    return fileFor(path);
  }
};

(window as any).__app = {
  vault,
  metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: parse(files.get(f.path) ?? "").flagged ? { zahlbar: 1 } : undefined }) },
  workspace: { getLeaf: () => ({ openFile: async (f: TFile, o?: { eState?: { line?: number } }) => opened.push({ path: f.path, ...(o?.eState?.line !== undefined ? { line: o.eState.line } : {}) }) }) }
};

(window as any).__em = {
  files,
  opened,
  text: (p = "Plan 2027.md") => files.get(p),
  /** an edit made outside the pane, like typing in the note */
  external(p: string, text: string, silent = false) {
    files.set(p, text);
    if (!silent) emit("modify", fileFor(p));
  },
  async boot(fixtures: Record<string, string>, open: string) {
    for (const [p, t] of Object.entries(fixtures)) files.set(p, t);
    const { ZahlbarView } = await import("../src/obsidian/view");
    const host = {
      planFiles: () => [...files.keys()].filter((p) => parse(files.get(p)!).flagged).map(fileFor),
      createPlan: async () => vault.create("Plan.md", "---\nzahlbar: 1\n---\n# Plan\n"),
      rememberFile: () => {},
      listWidth: undefined as number | undefined,
      saveListWidth(px: number | undefined) {
        this.listWidth = px;
        (window as any).__em.savedWidth = px ?? null;
      }
    };
    const view = new ZahlbarView({} as any, host as any);
    document.getElementById("pane")!.append(view.contentEl);
    await view.onOpen();
    await view.openFile(fileFor(open) as any);
    (window as any).__view = view;
    return true;
  }
};
