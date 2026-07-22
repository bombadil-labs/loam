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
      "demos/pachyderm/**",
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
  // Hazard H6, closed at the layer types cannot reach. `lensOf`/`programOf` brand the two names so
  // `LensName === ProgramName` is a compile error — but rhizomatic types `hyperschema.name` as bare
  // `string`, so a raw `r.hyperschema.name === <aLensName>` slips past the checker (string vs a brand
  // is allowed). This forbids `.hyperschema.name` as an operand of a comparison in the door files:
  // route a program name through `programOf(r)` and the brand is restored, so the comparison is
  // checked. Reading `.hyperschema.name` for any OTHER purpose (building a materialization key, a
  // message) is untouched — only the comparison, which is the one that decides authorization.
  {
    files: ["src/gateway/**/*.ts", "src/surface/**/*.ts", "src/server/**/*.ts"],
    ignores: ["src/gateway/registration.ts"], // where lensOf/programOf are defined
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator=/^[=!]==?$/] > MemberExpression[property.name='name'][object.property.name='hyperschema']",
          message:
            "Do not compare `.hyperschema.name` directly — it is a bare string and bypasses the LensName/ProgramName brand (hazard H6). Route it through `programOf(r)`, which restores the brand so the comparison is type-checked.",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
