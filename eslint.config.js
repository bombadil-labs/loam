import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
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
      ".claude/worktrees/**",
      "test/gateway/fixtures/*.bundle.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js", "**/*.mjs"], ...tseslint.configs.disableTypeChecked },
  {
    files: ["demos/tutorial/**/*.mjs", "demos/capabilities/**/*.mjs"],
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
        getComputedStyle: "readonly",
        IntersectionObserver: "readonly",
      },
    },
  },
  {
    files: ["demos/*.mjs", "demos/board/*.mjs"],
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
  {
    files: ["refactor/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    files: ["src/gateway/**/*.ts", "src/surface/**/*.ts", "src/server/**/*.ts"],
    ignores: ["src/gateway/registration.ts"],
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
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": false }],
    },
  },
  eslintConfigPrettier,
);
