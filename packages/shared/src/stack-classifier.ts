// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stack classifier — pure function that maps a set of file-exists probes
 * against a Git repo to a stack classification with build recommendation.
 *
 * Design choices:
 *  - Pure function, no I/O. Callers (web wizard, API, CLI) feed the probe
 *    results after running their own HEAD checks.
 *  - Priority-ordered rules: Dockerfile > Compose > framework-specific
 *    (Laravel/Symfony/Next/Django) > generic language > Static > Unknown.
 *  - Each rule yields a confidence: "high" when two independent signals
 *    agree (composer.json + artisan), "medium" when a single strong signal,
 *    "low" for ambiguous cases.
 *  - The recommended build method is orthogonal to the stack: PHP stacks
 *    recommend "nixpacks" by default (like Dokploy/Coolify),
 *    a user-provided Dockerfile always wins.
 */

export type Stack =
  | "laravel"
  | "symfony"
  | "php"
  | "next"
  | "remix"
  | "astro"
  | "node"
  | "bun"
  | "deno"
  | "django"
  | "flask"
  | "fastapi"
  | "python"
  | "go"
  | "rust"
  | "ruby"
  | "elixir"
  | "java"
  | "compose"
  | "static"
  | "unknown"

export type BuildMethodRecommendation =
  | "auto"
  | "dockerfile"
  | "compose"
  | "nixpacks"
  | "railpack"

export type ProbeKey =
  // Docker / Compose
  | "Dockerfile"
  | "compose.yaml"
  | "compose.yml"
  | "docker-compose.yml"
  | "docker-compose.yaml"
  // PHP
  | "composer.json"
  | "artisan"
  | "symfony.lock"
  | "bin/console"
  // JS / TS
  | "package.json"
  | "next.config.js"
  | "next.config.mjs"
  | "next.config.ts"
  | "remix.config.js"
  | "astro.config.mjs"
  | "astro.config.ts"
  | "deno.json"
  | "bun.lockb"
  // Python
  | "pyproject.toml"
  | "requirements.txt"
  | "manage.py"
  // Other languages
  | "go.mod"
  | "Cargo.toml"
  | "Gemfile"
  | "mix.exs"
  | "pom.xml"
  | "build.gradle"
  | "build.gradle.kts"
  // Static
  | "index.html"

/**
 * Map of probe key → existence. A probe absent from the record is treated as
 * false (not yet fetched callers should pre-populate with false explicitly to
 * opt in to a deterministic classification).
 */
export type ProbeResults = Partial<Record<ProbeKey, boolean>>

export interface StackClassification {
  stack: Stack
  framework?: string
  confidence: "high" | "medium" | "low"
  /** Ordered signals that triggered the classification. */
  signals: ProbeKey[]
  recommendedBuild: BuildMethodRecommendation
  /** Human-readable warnings to show the user in the wizard. */
  warnings: string[]
  /**
   * Env vars Ploydok will auto-inject so the detected framework works out-of-the-box
   * under Nixpacks/Railpack without any manual configuration from the user.
   * Empty for stacks that Nixpacks handles natively (e.g. Laravel).
   */
  suggestedEnvVars: Record<string, string>
}

/** Ordered list of all probe keys the classifier understands. */
export const ALL_PROBE_KEYS: ReadonlyArray<ProbeKey> = [
  "Dockerfile",
  "compose.yaml",
  "compose.yml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "composer.json",
  "artisan",
  "symfony.lock",
  "bin/console",
  "package.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "remix.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "deno.json",
  "bun.lockb",
  "pyproject.toml",
  "requirements.txt",
  "manage.py",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "mix.exs",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "index.html",
]

function has(probes: ProbeResults, key: ProbeKey): boolean {
  return probes[key] === true
}

function hasAny(probes: ProbeResults, keys: ReadonlyArray<ProbeKey>): boolean {
  for (const k of keys) if (has(probes, k)) return true
  return false
}

function composeSignal(probes: ProbeResults): ProbeKey | null {
  const candidates: ReadonlyArray<ProbeKey> = [
    "compose.yaml",
    "compose.yml",
    "docker-compose.yml",
    "docker-compose.yaml",
  ]
  for (const k of candidates) if (has(probes, k)) return k
  return null
}

/**
 * classify a repository from probe results. Pure function, deterministic.
 */
export function classifyStack(probes: ProbeResults): StackClassification {
  // 1. User-provided Dockerfile wins — no other signal can override.
  if (has(probes, "Dockerfile")) {
    return {
      stack: "unknown",
      framework: "Dockerfile",
      confidence: "high",
      signals: ["Dockerfile"],
      recommendedBuild: "dockerfile",
      warnings: [],
      suggestedEnvVars: {},
    }
  }

  // 2. Compose detected (Ploydok doesn't yet run compose natively — warn).
  const compose = composeSignal(probes)
  if (compose) {
    const hasDockerfileBuild = false // already handled above
    return {
      stack: "compose",
      framework: "Docker Compose",
      confidence: "high",
      signals: [compose],
      recommendedBuild: "compose",
      warnings: hasDockerfileBuild
        ? []
        : [
            "Docker Compose détecté — support natif prévu sprint 3.3. Pour l'instant, fallback dockerfile ou nixpacks.",
          ],
      suggestedEnvVars: {},
    }
  }

  // 3. PHP — Laravel, Symfony, generic
  if (has(probes, "composer.json")) {
    const signals: ProbeKey[] = ["composer.json"]
    if (has(probes, "artisan")) {
      signals.push("artisan")
      // Laravel often has a Vite front-end (package.json)
      const hasNodeFrontend = has(probes, "package.json")
      if (hasNodeFrontend) signals.push("package.json")
      return {
        stack: "laravel",
        framework: "Laravel",
        confidence: "high",
        signals,
        recommendedBuild: "nixpacks",
        warnings: [],
        // Defaults that make a fresh Laravel repo healthy on first deploy
        // without user config:
        // - SESSION_DRIVER=file / CACHE_STORE=file: Laravel 11+ defaults to
        //   `database` which reads/writes a sqlite file the fixture does
        //   not ship. File-backed sessions sidestep that on zero-DB
        //   deploys.
        // - NIXPACKS_NODE_VERSION=20: Vite ≥ 5 requires Node ≥ 20; Nixpacks
        //   defaults to 18 which crashes on `vite build` (CustomEvent).
        //   Only pinned when package.json is present.
        // APP_KEY is NOT auto-injected: every app must get its own (sprint-6
        // will add auto-generation on first deploy).
        suggestedEnvVars: {
          SESSION_DRIVER: "file",
          CACHE_STORE: "file",
          ...(hasNodeFrontend ? { NIXPACKS_NODE_VERSION: "20" } : {}),
        },
      }
    }
    if (has(probes, "symfony.lock") || has(probes, "bin/console")) {
      if (has(probes, "symfony.lock")) signals.push("symfony.lock")
      if (has(probes, "bin/console")) signals.push("bin/console")
      return {
        stack: "symfony",
        framework: "Symfony",
        confidence: "high",
        signals,
        recommendedBuild: "nixpacks",
        warnings: [],
        // - NIXPACKS_PHP_ROOT_DIR / NIXPACKS_PHP_FALLBACK_PATH: Nixpacks'
        //   Laravel-centric PHP provider only rewrites index.php when these
        //   are set (Coolify documents the same gotcha).
        // - NIXPACKS_INSTALL_CMD: Symfony Flex's auto-scripts hook runs
        //   `symfony-cmd` after composer install. That binary doesn't exist
        //   when composer plugins are disabled in root-run containers, so
        //   the install phase fails with exit 127. `--no-scripts` skips the
        //   flex hook while keeping the vendor autoloader intact — this is
        //   the exact pattern the dunglas/symfony-docker template uses.
        // APP_ENV is intentionally NOT injected: `prod` on a fresh repo
        // without DATABASE_URL / writable var/cache breaks cache:warmup and
        // makes the app 500 on every route. The user sets APP_ENV per
        // environment scope (sprint-4) once the DB is wired.
        suggestedEnvVars: {
          NIXPACKS_PHP_ROOT_DIR: "/app/public",
          NIXPACKS_PHP_FALLBACK_PATH: "/index.php",
          NIXPACKS_INSTALL_CMD:
            "mkdir -p /var/log/nginx /var/cache/nginx && composer install --no-interaction --no-scripts --no-progress --prefer-dist --ignore-platform-reqs --optimize-autoloader",
        },
      }
    }
    return {
      stack: "php",
      framework: "PHP",
      confidence: "medium",
      signals,
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }

  // 4. JS / TS — frameworks then generic Node/Bun/Deno
  if (has(probes, "package.json")) {
    const nextCfg = (
      ["next.config.js", "next.config.mjs", "next.config.ts"] as const
    ).find((k) => has(probes, k))
    if (nextCfg) {
      return {
        stack: "next",
        framework: "Next.js",
        confidence: "high",
        signals: ["package.json", nextCfg],
        recommendedBuild: "nixpacks",
        warnings: [],
        suggestedEnvVars: {},
      }
    }
    if (has(probes, "remix.config.js")) {
      return {
        stack: "remix",
        framework: "Remix",
        confidence: "high",
        signals: ["package.json", "remix.config.js"],
        recommendedBuild: "nixpacks",
        warnings: [],
        suggestedEnvVars: {},
      }
    }
    const astroCfg = (["astro.config.mjs", "astro.config.ts"] as const).find(
      (k) => has(probes, k)
    )
    if (astroCfg) {
      return {
        stack: "astro",
        framework: "Astro",
        confidence: "high",
        signals: ["package.json", astroCfg],
        recommendedBuild: "nixpacks",
        warnings: [],
        suggestedEnvVars: {},
      }
    }
    if (has(probes, "bun.lockb")) {
      return {
        stack: "bun",
        framework: "Bun",
        confidence: "high",
        signals: ["package.json", "bun.lockb"],
        recommendedBuild: "nixpacks",
        warnings: [],
        suggestedEnvVars: {},
      }
    }
    return {
      stack: "node",
      framework: "Node.js",
      confidence: "medium",
      signals: ["package.json"],
      recommendedBuild: "nixpacks",
      warnings: [
        "Vérifie NIXPACKS_NODE_VERSION si ton projet cible Node ≥ 20 (Node 18 EOL en 2025).",
      ],
      suggestedEnvVars: {},
    }
  }

  if (has(probes, "deno.json")) {
    return {
      stack: "deno",
      framework: "Deno",
      confidence: "high",
      signals: ["deno.json"],
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }

  // 5. Python — Django / Flask / FastAPI / generic
  if (has(probes, "manage.py")) {
    const signals: ProbeKey[] = ["manage.py"]
    if (has(probes, "pyproject.toml")) signals.push("pyproject.toml")
    else if (has(probes, "requirements.txt")) signals.push("requirements.txt")
    return {
      stack: "django",
      framework: "Django",
      confidence: "high",
      signals,
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: { PYTHON_VERSION: "3.12" },
    }
  }
  if (hasAny(probes, ["pyproject.toml", "requirements.txt"])) {
    return {
      stack: "python",
      framework: "Python",
      confidence: "medium",
      signals: has(probes, "pyproject.toml")
        ? ["pyproject.toml"]
        : ["requirements.txt"],
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }

  // 6. Go / Rust / Ruby / Elixir / Java
  if (has(probes, "go.mod")) {
    return {
      stack: "go",
      framework: "Go",
      confidence: "high",
      signals: ["go.mod"],
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }
  if (has(probes, "Cargo.toml")) {
    return {
      stack: "rust",
      framework: "Rust",
      confidence: "high",
      signals: ["Cargo.toml"],
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }
  if (has(probes, "Gemfile")) {
    return {
      stack: "ruby",
      framework: "Ruby",
      confidence: "medium",
      signals: ["Gemfile"],
      recommendedBuild: "nixpacks",
      warnings: [
        "Support Ruby dans nixpacks upstream est partiel — tester le build avant de compter dessus.",
      ],
      suggestedEnvVars: {
        RAILS_ENV: "production",
        RAILS_SERVE_STATIC_FILES: "true",
      },
    }
  }
  if (has(probes, "mix.exs")) {
    return {
      stack: "elixir",
      framework: "Elixir",
      confidence: "high",
      signals: ["mix.exs"],
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }
  if (hasAny(probes, ["pom.xml", "build.gradle", "build.gradle.kts"])) {
    const sig: ProbeKey = has(probes, "pom.xml")
      ? "pom.xml"
      : has(probes, "build.gradle")
        ? "build.gradle"
        : "build.gradle.kts"
    return {
      stack: "java",
      framework: "Java/JVM",
      confidence: "medium",
      signals: [sig],
      recommendedBuild: "dockerfile",
      warnings: [
        "Support JVM dans nixpacks est patchy — préfère un Dockerfile.",
      ],
      suggestedEnvVars: {},
    }
  }

  // 7. Static site
  if (has(probes, "index.html")) {
    return {
      stack: "static",
      framework: "Static HTML",
      confidence: "medium",
      signals: ["index.html"],
      recommendedBuild: "nixpacks",
      warnings: [],
      suggestedEnvVars: {},
    }
  }

  // 8. Nothing matched
  return {
    stack: "unknown",
    confidence: "low",
    signals: [],
    recommendedBuild: "auto",
    warnings: [
      "Aucune stack reconnue — ajoute un Dockerfile ou choisis manuellement un build method.",
    ],
    suggestedEnvVars: {},
  }
}
