// Copies the built plugin into a vault and enables it.
// usage: node scripts/install-vault.js "<path to vault>"   (or set ZAHLBAR_VAULT)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vault = process.argv[2] ?? process.env.ZAHLBAR_VAULT;
if (!vault) throw new Error('Pass the vault path: npm run install:vault -- "<vault>"');
if (!existsSync(join(vault, ".obsidian"))) throw new Error(`${vault} has no .obsidian folder, is it a vault?`);

const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) if (!existsSync(join(root, f))) throw new Error(`Missing ${f}, run npm run build first`);

const target = join(vault, ".obsidian", "plugins", "zahlbar");
mkdirSync(target, { recursive: true });
for (const f of files) copyFileSync(join(root, f), join(target, f));

const listPath = join(vault, ".obsidian", "community-plugins.json");
const enabled = existsSync(listPath) ? JSON.parse(readFileSync(listPath, "utf8")) : [];
if (!enabled.includes("zahlbar")) {
  enabled.push("zahlbar");
  writeFileSync(listPath, JSON.stringify(enabled, null, 2));
}
console.log(`Installed to ${target}. Reload Obsidian (or toggle the plugin) to pick it up.`);
