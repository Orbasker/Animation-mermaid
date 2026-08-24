import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// Architecture boundaries. The layers form a one-way dependency graph:
//   lib (leaf) ← domain ← persistence ← app
// A layer may only import from itself and the layers below it. These zones
// stop an inversion (e.g. domain reaching into persistence) at lint time.
const restrictedImport = (message, patterns) => ({
  "no-restricted-imports": [
    "error",
    { patterns: patterns.map((group) => ({ group, message })) },
  ],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: "naming-conventions",
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    plugins: { "ts-naming": tseslint.plugin },
    rules: {
      "ts-naming/naming-convention": [
        "error",
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: { regex: "^I[A-Z]", match: false },
        },
        { selector: "enumMember", format: ["PascalCase"] },
      ],
    },
  },
  {
    name: "boundary-domain",
    files: ["src/domain/**"],
    rules: restrictedImport(
      "The domain layer is pure: it may only import from @/domain.",
      [["@/app/**", "@/persistence/**", "@/lib/**"]],
    ),
  },
  {
    name: "boundary-lib",
    files: ["src/lib/**"],
    rules: restrictedImport(
      "@/lib is a leaf utility layer and must not import other app layers.",
      [["@/app/**", "@/domain/**", "@/persistence/**"]],
    ),
  },
  {
    name: "boundary-persistence",
    files: ["src/persistence/**"],
    rules: restrictedImport(
      "@/persistence may depend on @/domain, not on app-level layers.",
      [["@/app/**"]],
    ),
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    ".output/**",
    ".vercel/**",
    ".swc/**",
    "next-env.d.ts",
  ]),
]);
