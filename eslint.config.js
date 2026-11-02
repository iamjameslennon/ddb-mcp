import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

// Shared across every TypeScript block so shipped source, tests and helper
// scripts are held to one standard.
const tsRules = {
  ...tseslint.configs.recommended.rules,
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "no-console": "off",
};

export default [
  {
    ignores: ["dist/", "node_modules/", "coverage/", "graphify-out/"],
  },

  // Shipped source — type-aware linting against tsconfig.json.
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: tsRules,
  },

  // Tests, .mts helper scripts, and root-level TS config. tsconfig.json sets
  // rootDir "src" and include ["src/**/*"], so none of these are in the
  // published-build project (tests are type-checked separately by
  // tsconfig.test.json, which nothing here uses for linting). The recommended
  // ruleset needs no type information, so lint them without `project`;
  // type-aware linting of tests is possible via tsconfig.test.json but is not
  // enabled.
  {
    files: ["tests/**/*.ts", "scripts/**/*.mts", "*.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: tsRules,
  },

  // Plain-JS tooling: release.js, the .mjs diagnostics, this config itself.
  // release.js pushes tags and triggers publishes, so it is the last thing that
  // should go unchecked.
  {
    files: ["scripts/**/*.{js,mjs}", "*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
];
