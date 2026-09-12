import { defineConfig, globalIgnores } from "eslint/config";
import next from "@next/eslint-plugin-next";
import hooks from "eslint-plugin-react-hooks";
import ts from "typescript-eslint";

export default defineConfig([
  ...ts.configs.recommended,
  {
    plugins: { "@next/next": next, "react-hooks": hooks },
    rules: { ...next.configs.recommended.rules, ...next.configs["core-web-vitals"].rules, ...hooks.configs.recommended.rules },
  },
  globalIgnores([".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"]),
]);
