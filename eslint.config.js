// Flat ESLint config (ESLint 9). Correctness linting only — formatting is Prettier's job,
// and eslint-config-prettier turns off any rules that would fight it.
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);
