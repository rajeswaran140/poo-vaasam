import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    // `next lint` applied these ignores implicitly. Moving to the ESLint CLI
    // (`next lint` is deprecated and removed in Next 16) means declaring them
    // explicitly — without this, `eslint .` walks build output and reports tens
    // of thousands of problems in generated code.
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      // Bundled Lambda/worker output — generated, not source.
      "worker-dist/**",
      "measure-fn-dist/**",
      "master-worker-dist/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Allow any types - we'll gradually improve type safety
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars with underscore prefix
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      // Allow img elements (we'll migrate to next/image gradually)
      "@next/next/no-img-element": "warn"
    }
  },
  {
    // Test files: jest mocks are frequently anonymous arrow components, which
    // react/display-name flags. These were never linted under `next lint`, so
    // the rule is scoped off here rather than papered over with inline disables.
    files: ["__tests__/**", "tests/**"],
    rules: {
      "react/display-name": "off",
    },
  },
  {
    // Plain CommonJS Node scripts — `require()` is correct here, not a lapse.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
