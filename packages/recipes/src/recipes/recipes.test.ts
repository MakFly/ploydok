// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "bun:test";
import { renderRecipe, listRecipes, getRecipe } from "../index";

describe("recipes registry", () => {
  it("exposes the 3 PHP recipes", () => {
    const ids = listRecipes().map((r) => r.id).sort();
    expect(ids).toEqual(["php-generic.v1", "php-laravel.v1", "php-symfony.v1"]);
  });

  it("getRecipe throws on unknown id", () => {
    expect(() => getRecipe("nope" as never)).toThrow();
  });
});

describe("php-laravel.v1", () => {
  it("renders 4 files with sane defaults", () => {
    const r = renderRecipe("php-laravel.v1");
    expect(Object.keys(r.files).sort()).toEqual([
      "Dockerfile",
      "ploydok/entrypoint.sh",
      "ploydok/nginx.conf",
      "ploydok/php-fpm.conf",
    ]);
    expect(r.dockerfilePath).toBe("Dockerfile");
    expect(r.runtimePort).toBe(80);
  });

  it("Dockerfile uses php:8.3-fpm-alpine and multi-stage", () => {
    const r = renderRecipe("php-laravel.v1");
    const dockerfile = r.files["Dockerfile"];
    expect(dockerfile).toContain("FROM composer:2 AS vendor");
    expect(dockerfile).toContain("FROM node:20-alpine AS assets");
    expect(dockerfile).toContain("FROM php:8.3-fpm-alpine AS runtime");
    expect(dockerfile).toContain("docker-php-ext-install");
    expect(dockerfile).toContain("pdo_pgsql");
    expect(dockerfile).toContain("opcache");
  });

  it("nginx.conf has Laravel-aware try_files", () => {
    const r = renderRecipe("php-laravel.v1");
    const nginx = r.files["ploydok/nginx.conf"];
    expect(nginx).toContain("try_files $uri $uri/ /index.php?$query_string");
    expect(nginx).toContain("error_page 404 /index.php");
    expect(nginx).toContain("listen 80 default_server");
  });

  it("entrypoint runs migrations and warms cache", () => {
    const r = renderRecipe("php-laravel.v1");
    const ep = r.files["ploydok/entrypoint.sh"];
    expect(ep).toContain("php artisan config:cache");
    expect(ep).toContain("php artisan migrate --force");
    expect(ep).toMatch(/php-fpm.*nginx/s);
  });

  it("honors custom phpVersion and warns", () => {
    const r = renderRecipe("php-laravel.v1", { phpVersion: "8.2" });
    expect(r.files["Dockerfile"]).toContain("FROM php:8.2-fpm-alpine");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("honors custom rootDir (monorepo)", () => {
    const r = renderRecipe("php-laravel.v1", { rootDir: "apps/web" });
    expect(r.files["Dockerfile"]).toContain("COPY apps/web/composer.json");
    expect(r.files["Dockerfile"]).toContain("COPY apps/web /app");
  });

  it("honors custom runtimePort", () => {
    const r = renderRecipe("php-laravel.v1", { runtimePort: 8080 });
    expect(r.runtimePort).toBe(8080);
    expect(r.files["ploydok/nginx.conf"]).toContain("listen 8080");
    expect(r.files["Dockerfile"]).toContain("EXPOSE 8080");
  });
});

describe("php-symfony.v1", () => {
  it("renders with php:8.4 by default and Symfony front-controller nginx", () => {
    const r = renderRecipe("php-symfony.v1");
    expect(r.files["Dockerfile"]).toContain("FROM php:8.4-fpm-alpine");
    expect(r.files["ploydok/nginx.conf"]).toContain("try_files $uri /index.php$is_args$args");
    expect(r.files["ploydok/nginx.conf"]).toContain("location ~ \\.php$ { return 404; }");
    expect(r.files["ploydok/entrypoint.sh"]).toContain("doctrine:migrations:migrate");
  });

  it("skips the Node stage unless a build command is provided", () => {
    const r = renderRecipe("php-symfony.v1");
    expect(r.files["Dockerfile"]).not.toContain("FROM node:");
  });

  it("includes Node stage when buildCommand provided", () => {
    const r = renderRecipe("php-symfony.v1", { buildCommand: "yarn build" });
    expect(r.files["Dockerfile"]).toContain("FROM node:20-alpine AS assets");
    expect(r.files["Dockerfile"]).toContain("yarn build");
  });
});

describe("php-generic.v1", () => {
  it("minimal stack, no framework-specific hooks", () => {
    const r = renderRecipe("php-generic.v1");
    const ep = r.files["ploydok/entrypoint.sh"];
    expect(ep).not.toContain("artisan");
    expect(ep).not.toContain("doctrine");
    expect(r.files["Dockerfile"]).toContain("FROM php:8.3-fpm-alpine");
  });
});

describe("cross-recipe invariants", () => {
  for (const recipe of listRecipes()) {
    it(`${recipe.id}: runtime image is alpine + exposes port`, () => {
      const r = recipe.render({});
      const df = r.files["Dockerfile"];
      expect(df).toContain("-fpm-alpine");
      expect(df).toContain(`EXPOSE ${r.runtimePort}`);
      expect(df).toContain("ENTRYPOINT");
    });

    it(`${recipe.id}: entrypoint starts both php-fpm and nginx`, () => {
      const r = recipe.render({});
      const ep = r.files["ploydok/entrypoint.sh"];
      expect(ep).toContain("php-fpm");
      expect(ep).toContain("nginx");
    });

    it(`${recipe.id}: nginx listens on the declared runtimePort`, () => {
      const r = recipe.render({ runtimePort: 3000 });
      expect(r.files["ploydok/nginx.conf"]).toContain("listen 3000");
      expect(r.runtimePort).toBe(3000);
    });
  }
});
