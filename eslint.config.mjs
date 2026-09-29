import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Vendored MapLibre v6 worker + its sibling chunk, copied verbatim
      // from node_modules into public/ so the worker resolves by relative
      // path. Never hand-edited — excluded so its minified internals don't
      // drown real lint output (1,123 noise warnings before this).
      "public/maplibre/**",
    ],
  },
];

export default eslintConfig;
