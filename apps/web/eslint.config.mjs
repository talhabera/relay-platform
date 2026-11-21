import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A leading underscore is how this codebase says "required by the
    // signature, deliberately unread" — a parameter kept for arity, a catch
    // binding for an error there is nothing useful to do with. Without this,
    // the only way to silence the rule is to delete something a caller or the
    // language still requires.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // `dev.cjs` and `load-root-env.cjs` run under plain node before Next
    // starts: they load the root `.env` and resolve the `next` binary, which
    // needs `require.resolve` and `__dirname`. CommonJS is the point of the
    // `.cjs` extension, so `require` is correct there, not a leftover.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
