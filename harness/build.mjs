// Bundles the real view with the obsidian module stubbed out.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = {
  name: "obsidian-stub",
  setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(here, "obsidian-stub.ts") }));
  }
};
await build({
  entryPoints: [path.join(here, "entry.ts")],
  bundle: true,
  outfile: path.join(here, "dist", "harness.js"),
  format: "iife",
  platform: "browser",
  target: "es2022",
  plugins: [stub],
  logLevel: "warning"
});
console.log("built harness");
