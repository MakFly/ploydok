//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  {
    ignores: [
      "public/clones/**",
      "test-results/**",
      "playwright-report/**",
      ".output/**",
      ".vite/**",
      "src/routeTree.gen.ts",
    ],
  },
  ...tanstackConfig,
]
