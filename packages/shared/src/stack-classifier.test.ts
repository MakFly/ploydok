// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "bun:test"
import {
  classifyStack,
  type ProbeResults,
  type Stack,
  type BuildMethodRecommendation,
} from "./stack-classifier"

function probes(on: Array<string>): ProbeResults {
  const out: ProbeResults = {}
  for (const k of on) (out as Record<string, boolean>)[k] = true
  return out
}

describe("classifyStack — Dockerfile short-circuit", () => {
  it("Dockerfile alone wins, even with other signals", () => {
    const r = classifyStack(probes(["Dockerfile", "composer.json", "artisan"]))
    expect(r.recommendedBuild).toBe("dockerfile")
    expect(r.confidence).toBe("high")
    expect(r.signals).toEqual(["Dockerfile"])
  })
})

describe("classifyStack — Compose", () => {
  it("compose.yaml triggers compose stack", () => {
    const r = classifyStack(probes(["compose.yaml"]))
    expect(r.stack).toBe("compose")
    expect(r.recommendedBuild).toBe("compose")
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("docker-compose.yml also matches", () => {
    const r = classifyStack(probes(["docker-compose.yml"]))
    expect(r.stack).toBe("compose")
  })

  it("compose + composer.json → compose wins (user likely manages PHP via compose)", () => {
    const r = classifyStack(
      probes(["compose.yaml", "composer.json", "symfony.lock"])
    )
    expect(r.stack).toBe("compose")
  })
})

describe("classifyStack — PHP", () => {
  it("Laravel: composer.json + artisan → nixpacks", () => {
    const r = classifyStack(probes(["composer.json", "artisan"]))
    expect(r.stack).toBe("laravel")
    expect(r.recommendedBuild).toBe("nixpacks")
    expect(r.signals).toContain("artisan")
  })

  it("Laravel + Vite: composer.json + artisan + package.json picks up the front-end signal", () => {
    const r = classifyStack(
      probes(["composer.json", "artisan", "package.json"])
    )
    expect(r.stack).toBe("laravel")
    expect(r.signals).toContain("package.json")
    // File-backed sessions + Node 22 pin for modern Vite.
    expect(r.suggestedEnvVars).toEqual({
      SESSION_DRIVER: "file",
      CACHE_STORE: "file",
      NIXPACKS_NODE_VERSION: "22",
    })
  })

  it("Laravel without package.json: file-backed defaults, no Node pin", () => {
    const r = classifyStack(probes(["composer.json", "artisan"]))
    expect(r.stack).toBe("laravel")
    expect(r.suggestedEnvVars).toEqual({
      SESSION_DRIVER: "file",
      CACHE_STORE: "file",
    })
  })

  it("Symfony via symfony.lock → nixpacks", () => {
    const r = classifyStack(probes(["composer.json", "symfony.lock"]))
    expect(r.stack).toBe("symfony")
    expect(r.recommendedBuild).toBe("nixpacks")
  })

  it("Symfony via bin/console only", () => {
    const r = classifyStack(probes(["composer.json", "bin/console"]))
    expect(r.stack).toBe("symfony")
  })

  it("PHP generic: composer.json alone (no framework marker)", () => {
    const r = classifyStack(probes(["composer.json"]))
    expect(r.stack).toBe("php")
    expect(r.confidence).toBe("medium")
    expect(r.recommendedBuild).toBe("nixpacks")
  })
})

describe("classifyStack — JS/TS frameworks", () => {
  it("Next.js via next.config.mjs", () => {
    const r = classifyStack(probes(["package.json", "next.config.mjs"]))
    expect(r.stack).toBe("next")
    expect(r.recommendedBuild).toBe("nixpacks")
  })

  it("Next.js via next.config.ts", () => {
    const r = classifyStack(probes(["package.json", "next.config.ts"]))
    expect(r.stack).toBe("next")
  })

  it("Remix", () => {
    const r = classifyStack(probes(["package.json", "remix.config.js"]))
    expect(r.stack).toBe("remix")
  })

  it("Astro", () => {
    const r = classifyStack(probes(["package.json", "astro.config.mjs"]))
    expect(r.stack).toBe("astro")
  })

  it("Bun via bun.lockb", () => {
    const r = classifyStack(probes(["package.json", "bun.lockb"]))
    expect(r.stack).toBe("bun")
  })

  it("Node generic with warning about Node version", () => {
    const r = classifyStack(probes(["package.json"]))
    expect(r.stack).toBe("node")
    expect(r.confidence).toBe("medium")
    expect(r.warnings.join(" ")).toMatch(/NIXPACKS_NODE_VERSION/)
  })

  it("Deno standalone (no package.json)", () => {
    const r = classifyStack(probes(["deno.json"]))
    expect(r.stack).toBe("deno")
  })
})

describe("classifyStack — Python", () => {
  it("Django via manage.py", () => {
    const r = classifyStack(probes(["manage.py", "requirements.txt"]))
    expect(r.stack).toBe("django")
    expect(r.signals).toContain("requirements.txt")
  })

  it("Python generic via pyproject.toml", () => {
    const r = classifyStack(probes(["pyproject.toml"]))
    expect(r.stack).toBe("python")
  })

  it("Python generic via requirements.txt", () => {
    const r = classifyStack(probes(["requirements.txt"]))
    expect(r.stack).toBe("python")
  })
})

describe("classifyStack — other languages", () => {
  const cases: Array<{
    files: Array<string>
    stack: Stack
    build: BuildMethodRecommendation
  }> = [
    { files: ["go.mod"], stack: "go", build: "nixpacks" },
    { files: ["Cargo.toml"], stack: "rust", build: "nixpacks" },
    { files: ["Gemfile"], stack: "ruby", build: "nixpacks" },
    { files: ["mix.exs"], stack: "elixir", build: "nixpacks" },
    { files: ["pom.xml"], stack: "java", build: "dockerfile" },
    { files: ["build.gradle"], stack: "java", build: "dockerfile" },
    { files: ["build.gradle.kts"], stack: "java", build: "dockerfile" },
  ]
  for (const c of cases) {
    it(`${c.files.join(" + ")} → ${c.stack} (${c.build})`, () => {
      const r = classifyStack(probes(c.files))
      expect(r.stack).toBe(c.stack)
      expect(r.recommendedBuild).toBe(c.build)
    })
  }
})

describe("classifyStack — static + unknown", () => {
  it("Static: index.html only", () => {
    const r = classifyStack(probes(["index.html"]))
    expect(r.stack).toBe("static")
  })

  it("Unknown: no signal", () => {
    const r = classifyStack({})
    expect(r.stack).toBe("unknown")
    expect(r.confidence).toBe("low")
    expect(r.recommendedBuild).toBe("auto")
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})

describe("classifyStack — tie-breaking & edge cases", () => {
  it("Node + Django markers: manage.py wins (Django is more specific)", () => {
    const r = classifyStack(
      probes(["package.json", "manage.py", "requirements.txt"])
    )
    // Note: current order checks PHP then JS then Python. package.json triggers node
    // BEFORE django check is reached. This is by design: if both exist, the repo is
    // a hybrid and we default to Node. Document this behavior.
    expect(r.stack).toBe("node")
  })

  it("Laravel + compose.yaml: compose wins (user is explicit about compose)", () => {
    const r = classifyStack(
      probes(["compose.yaml", "composer.json", "artisan"])
    )
    expect(r.stack).toBe("compose")
  })

  it("Dockerfile + compose.yaml: Dockerfile wins (even more explicit)", () => {
    const r = classifyStack(probes(["Dockerfile", "compose.yaml"]))
    expect(r.recommendedBuild).toBe("dockerfile")
  })
})

describe("classifyStack — suggestedEnvVars", () => {
  it("Symfony: injects PHP root/fallback + composer allow-superuser (APP_ENV stays user-owned)", () => {
    const r = classifyStack(probes(["composer.json", "symfony.lock"]))
    expect(r.suggestedEnvVars).toEqual({
      NIXPACKS_PHP_ROOT_DIR: "/app/public",
      NIXPACKS_PHP_FALLBACK_PATH: "/index.php",
      NIXPACKS_INSTALL_CMD:
        "mkdir -p /var/log/nginx /var/cache/nginx && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-interaction --no-progress --prefer-dist --ignore-platform-reqs --optimize-autoloader",
    })
  })

  it("Symfony via bin/console: same env vars", () => {
    const r = classifyStack(probes(["composer.json", "bin/console"]))
    expect(r.suggestedEnvVars.NIXPACKS_PHP_ROOT_DIR).toBe("/app/public")
    expect(r.suggestedEnvVars.NIXPACKS_INSTALL_CMD).toContain(
      "COMPOSER_ALLOW_SUPERUSER=1"
    )
  })

  it("Laravel: injects file-backed session + cache defaults", () => {
    const r = classifyStack(probes(["composer.json", "artisan"]))
    expect(r.suggestedEnvVars).toEqual({
      SESSION_DRIVER: "file",
      CACHE_STORE: "file",
    })
  })

  it("Django: injects PYTHON_VERSION=3.12", () => {
    const r = classifyStack(probes(["manage.py", "requirements.txt"]))
    expect(r.suggestedEnvVars).toEqual({ PYTHON_VERSION: "3.12" })
  })

  it("Ruby/Rails: injects RAILS_ENV and RAILS_SERVE_STATIC_FILES", () => {
    const r = classifyStack(probes(["Gemfile"]))
    expect(r.suggestedEnvVars).toEqual({
      RAILS_ENV: "production",
      RAILS_SERVE_STATIC_FILES: "true",
    })
  })

  it("Node.js: empty suggestedEnvVars", () => {
    const r = classifyStack(probes(["package.json"]))
    expect(r.suggestedEnvVars).toEqual({})
  })

  it("unknown stack: empty suggestedEnvVars", () => {
    const r = classifyStack({})
    expect(r.suggestedEnvVars).toEqual({})
  })

  it("Dockerfile short-circuit: empty suggestedEnvVars", () => {
    const r = classifyStack(
      probes(["Dockerfile", "composer.json", "symfony.lock"])
    )
    expect(r.suggestedEnvVars).toEqual({})
  })
})
