import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["main.js", "**/node_modules/**", "harness/dist/**", "**/*.js", "**/*.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  },
  {
    // the core stays pure so it can be unit tested and reused outside Obsidian
    files: ["src/core/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: ["obsidian", "../obsidian/*"] }] }
  }
);
