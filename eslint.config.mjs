import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      /**
       * Every string the UI renders — feedback text, bullet rewrites, red
       * flags — originates from a language model reading a file a stranger
       * uploaded. React escapes it by default; `dangerouslySetInnerHTML` is
       * the one way to opt out, so the rule closes that door rather than
       * relying on nobody ever opening it.
       */
      "react/no-danger": "error",

      // Underscore-prefixed bindings are deliberate discards — destructuring a
      // key off an object precisely so it is *not* passed on.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client — machine-written, not ours to lint.
    "lib/generated/**",
  ]),
]);

export default eslintConfig;
