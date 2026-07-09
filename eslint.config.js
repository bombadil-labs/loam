// Flat ESLint config (ESLint 9). Correctness linting only — formatting is Prettier's job, and
// eslint-config-prettier turns off any rules that would fight it. Type-aware rules are on from
// the start: the plan is promise-heavy (an async store seam, a gateway), and a floating promise
// should die at lint time, not in production timing.
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // _testing is the ephemeral field-test playground (see _testing/PLAN.md): never committed,
  // never part of the gate.
  { ignores: ["dist/**", "_testing/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  eslintConfigPrettier,
);
