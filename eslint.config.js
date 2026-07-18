// Flat ESLint config (ESLint 9). Correctness linting only — formatting is Prettier's job, and
// eslint-config-prettier turns off any rules that would fight it. Type-aware rules are on from
// the start: the plan is promise-heavy (an async store seam, a gateway), and a floating promise
// should die at lint time, not in production timing.
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // demos/village is the living demonstration (see demos/village/README.md): committed, but
  // never part of the gate. scripts/ is release tooling — plain node, no project service.
  {
    ignores: [
      "dist/**",
      "site-dist/**",
      "demos/village/**",
      "demos/larder/**",
      "demos/planner/**",
      "scripts/**",
      ".adlc/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  // Plain-JS files (demos/tutorial/lessons.mjs is bundled into the page; the arc test types it via
  // demos/tutorial/lessons.d.mts) get syntax linting without the project service.
  { files: ["**/*.js", "**/*.mjs"], ...tseslint.configs.disableTypeChecked },
  // The page itself runs in a browser; say so instead of silencing no-undef.
  {
    files: ["demos/tutorial/**/*.mjs"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        Blob: "readonly",
        URL: "readonly",
        console: "readonly",
      },
    },
  },
  // Top-level demo scripts (e.g. demos/renderers-demo.mjs) run under Node — a runnable `node <file>`
  // like the village phases (which are ignored), so give them the Node globals rather than silencing.
  {
    files: ["demos/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  eslintConfigPrettier,
);
