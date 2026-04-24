// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test"
import { renderRecipe, listRecipes, getRecipe } from "../index"

describe("recipes registry", () => {
  it("exposes the 4 PHP recipes", () => {
    const ids = listRecipes()
      .map((r) => r.id)
      .sort()
    expect(ids).toEqual([
      "php-generic.v1",
      "php-laravel.v1",
      "php-symfony-frankenphp.v1",
      "php-symfony.v1",
    ])
  })

  it("getRecipe throws on unknown id", () => {
    expect(() => getRecipe("nope" as never)).toThrow()
  })
})

describe("php-laravel.v1", () => {
  it("renders 4 files with sane defaults", () => {
    const r = renderRecipe("php-laravel.v1")
    expect(Object.keys(r.files).sort()).toEqual([
      "Dockerfile",
      "ploydok/entrypoint.sh",
      "ploydok/nginx.conf",
      "ploydok/php-fpm.conf",
    ])
    expect(r.dockerfilePath).toBe("Dockerfile")
    expect(r.runtimePort).toBe(80)
  })

  it("Dockerfile uses php:8.3-fpm-alpine and multi-stage", () => {
    const r = renderRecipe("php-laravel.v1")
    const dockerfile = r.files["Dockerfile"]
    expect(dockerfile).toContain("FROM composer:2 AS vendor")
    expect(dockerfile).toContain("FROM node:20-alpine AS assets")
    expect(dockerfile).toContain("FROM php:8.3-fpm-alpine AS runtime")
    expect(dockerfile).toContain("docker-php-ext-install")
    expect(dockerfile).toContain("pdo_pgsql")
    expect(dockerfile).toContain("opcache")
  })

  it("nginx.conf has Laravel-aware try_files", () => {
    const r = renderRecipe("php-laravel.v1")
    const nginx = r.files["ploydok/nginx.conf"]
    expect(nginx).toContain("try_files $uri $uri/ /index.php?$query_string")
    expect(nginx).toContain("error_page 404 /index.php")
    expect(nginx).toContain("listen 80 default_server")
  })

  it("entrypoint runs migrations and warms cache", () => {
    const r = renderRecipe("php-laravel.v1")
    const ep = r.files["ploydok/entrypoint.sh"]
    expect(ep).toContain("php artisan config:cache")
    expect(ep).toContain("php artisan migrate --force")
    expect(ep).toMatch(/php-fpm.*nginx/s)
  })

  it("honors custom phpVersion and warns", () => {
    const r = renderRecipe("php-laravel.v1", { phpVersion: "8.2" })
    expect(r.files["Dockerfile"]).toContain("FROM php:8.2-fpm-alpine")
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("honors custom rootDir (monorepo)", () => {
    const r = renderRecipe("php-laravel.v1", { rootDir: "apps/web" })
    expect(r.files["Dockerfile"]).toContain("COPY apps/web/composer.json")
    expect(r.files["Dockerfile"]).toContain("COPY apps/web /app")
  })

  it("honors custom runtimePort", () => {
    const r = renderRecipe("php-laravel.v1", { runtimePort: 8080 })
    expect(r.runtimePort).toBe(8080)
    expect(r.files["ploydok/nginx.conf"]).toContain("listen 8080")
    expect(r.files["Dockerfile"]).toContain("EXPOSE 8080")
  })
})

describe("php-symfony.v1", () => {
  it("renders with php:8.4 by default and Symfony front-controller nginx", () => {
    const r = renderRecipe("php-symfony.v1")
    expect(r.files["Dockerfile"]).toContain("FROM php:8.4-fpm-alpine")
    expect(r.files["ploydok/nginx.conf"]).toContain(
      "try_files $uri /index.php$is_args$args"
    )
    expect(r.files["ploydok/nginx.conf"]).toContain(
      "location ~ \\.php$ { return 404; }"
    )
    expect(r.files["ploydok/entrypoint.sh"]).toContain(
      "doctrine:migrations:migrate"
    )
  })

  it("skips the Node stage unless a build command is provided", () => {
    const r = renderRecipe("php-symfony.v1")
    expect(r.files["Dockerfile"]).not.toContain("FROM node:")
  })

  it("includes Node stage when buildCommand provided", () => {
    const r = renderRecipe("php-symfony.v1", { buildCommand: "yarn build" })
    expect(r.files["Dockerfile"]).toContain("FROM node:20-alpine AS assets")
    expect(r.files["Dockerfile"]).toContain("yarn build")
  })
})

describe("php-generic.v1", () => {
  it("minimal stack, no framework-specific hooks", () => {
    const r = renderRecipe("php-generic.v1")
    const ep = r.files["ploydok/entrypoint.sh"]
    expect(ep).not.toContain("artisan")
    expect(ep).not.toContain("doctrine")
    expect(r.files["Dockerfile"]).toContain("FROM php:8.3-fpm-alpine")
  })
})

describe("php-symfony-frankenphp.v1", () => {
  it("renders Dockerfile + Caddyfile + entrypoint (no nginx/fpm configs)", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1")
    expect(Object.keys(r.files).sort()).toEqual([
      "Dockerfile",
      "ploydok/Caddyfile",
      "ploydok/entrypoint.sh",
    ])
    expect(r.dockerfilePath).toBe("Dockerfile")
    expect(r.runtimePort).toBe(80)
  })

  it("Dockerfile uses dunglas/frankenphp:1-php8.4 as runtime", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1")
    const df = r.files["Dockerfile"]
    expect(df).toContain("FROM composer:2 AS vendor")
    expect(df).toContain("FROM dunglas/frankenphp:1-php8.4 AS runtime")
    expect(df).not.toContain("-fpm-alpine")
  })

  it("Caddyfile wires php_server with the Symfony front-controller", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1")
    const caddy = r.files["ploydok/Caddyfile"]
    expect(caddy).toContain("php_server")
    expect(caddy).toContain("try_files {path} /index.php?{query}")
    expect(caddy).toContain(":80 {")
  })

  it("prod mode: worker mode enabled, APP_DEBUG=0", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1", { appEnv: "prod" })
    const ep = r.files["ploydok/entrypoint.sh"]
    expect(ep).toContain("worker /app/public/index.php")
    expect(ep).toContain("exec frankenphp run")
    expect(r.files["Dockerfile"]).toContain("APP_ENV=prod")
    expect(r.files["Dockerfile"]).toContain("APP_DEBUG=0")
    expect(r.files["Dockerfile"]).toContain("opcache.validate_timestamps=0")
    expect(r.files["Dockerfile"]).toContain("--no-dev")
    expect(r.warnings).toEqual([])
  })

  it("dev mode: worker mode disabled, APP_ENV=dev, composer keeps dev deps", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1", { appEnv: "dev" })
    const ep = r.files["ploydok/entrypoint.sh"]
    expect(ep).toContain("Worker mode OFF in non-prod")
    expect(ep).not.toContain("worker /app/public/index.php")
    const df = r.files["Dockerfile"]
    expect(df).toContain("APP_ENV=dev")
    expect(df).toContain("APP_DEBUG=1")
    expect(df).toContain("opcache.validate_timestamps=1")
    expect(df).not.toMatch(/--no-dev/)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("entrypoint runs doctrine migrations then execs frankenphp", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1")
    const ep = r.files["ploydok/entrypoint.sh"]
    expect(ep).toContain("doctrine:migrations:migrate")
    expect(ep).toMatch(/doctrine:migrations:migrate[\s\S]*exec frankenphp/)
  })

  it("honors custom runtimePort (Caddyfile + EXPOSE)", () => {
    const r = renderRecipe("php-symfony-frankenphp.v1", { runtimePort: 8080 })
    expect(r.runtimePort).toBe(8080)
    expect(r.files["ploydok/Caddyfile"]).toContain(":8080 {")
    expect(r.files["Dockerfile"]).toContain("EXPOSE 8080")
  })
})

// FPM+nginx recipes share a set of invariants. FrankenPHP is a different
// runtime (single Go process, Debian base, Caddy embedded) so it has its own
// dedicated block above.
const FPM_RECIPES = listRecipes().filter(
  (r) => r.id !== "php-symfony-frankenphp.v1"
)

describe("cross-recipe invariants (php-fpm + nginx)", () => {
  for (const recipe of FPM_RECIPES) {
    it(`${recipe.id}: runtime image is alpine + exposes port`, () => {
      const r = recipe.render({})
      const df = r.files["Dockerfile"]
      expect(df).toContain("-fpm-alpine")
      expect(df).toContain(`EXPOSE ${r.runtimePort}`)
      expect(df).toContain("ENTRYPOINT")
    })

    it(`${recipe.id}: entrypoint starts both php-fpm and nginx`, () => {
      const r = recipe.render({})
      const ep = r.files["ploydok/entrypoint.sh"]
      expect(ep).toContain("php-fpm")
      expect(ep).toContain("nginx")
    })

    it(`${recipe.id}: nginx listens on the declared runtimePort`, () => {
      const r = recipe.render({ runtimePort: 3000 })
      expect(r.files["ploydok/nginx.conf"]).toContain("listen 3000")
      expect(r.runtimePort).toBe(3000)
    })
  }
})
