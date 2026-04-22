// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import viteTsConfigPaths from "vite-tsconfig-paths"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

const config = defineConfig({
  plugins: [
    nitro(),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      // `src/lib/api.ts` dynamiquement-importe `@tanstack/react-start/server`
      // derrière un garde `typeof window !== "undefined"` pour forwarder les
      // cookies SSR sans créer un fichier `.server.ts` séparé (voir
      // `.claude/rules/auth.md`). On autorise explicitement cet importer.
      importProtection: {
        ignoreImporters: ["**/src/lib/api.ts"],
      },
    }),
    viteReact(),
  ],
})

export default config
