// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeId } from "@ploydok/shared";

export interface RecipeVars {
  /** PHP version (e.g. "8.3", "8.4"). Default per recipe. */
  phpVersion?: string;
  /** Node LTS version for the front-end build stage, if the recipe uses one. */
  nodeVersion?: string;
  /** Directory within the repo considered as the app root (monorepos). */
  rootDir?: string;
  /** Public web root inside the app (e.g. "public"). Default per recipe. */
  publicDir?: string;
  /** Override composer install flags. */
  composerFlags?: string;
  /** Front-end install command (only used when a recipe has a Node stage). */
  installCommand?: string;
  /** Front-end build command (only used when a recipe has a Node stage). */
  buildCommand?: string;
  /** Port the container listens on. Default 80. */
  runtimePort?: number;
  /**
   * Application environment baked into the image. Accepts any identifier so
   * users can mirror their framework's conventions:
   *   Symfony: prod | dev | test | staging | preprod | preview | ...
   *   Laravel: production | local | staging | ...
   *   Node:    production | development | test | ...
   *
   * Recipes set the container's APP_ENV / NODE_ENV to this raw value AND use
   * `isProductionAppEnv()` to decide whether to strip composer dev deps,
   * freeze opcache, disable debug — i.e. do a "production build".
   *
   * When omitted, recipes assume "prod" (safe default).
   */
  appEnv?: string;
}

export interface RecipeRenderResult {
  /**
   * Files to inject into the build context. Keys are paths relative to the
   * repo root (as cloned). Writers must not overwrite user files silently —
   * see `render.ts` for the collision policy.
   */
  files: Record<string, string>;
  /** Relative path to the Dockerfile inside the render result. */
  dockerfilePath: string;
  /** Port the image expects to be reachable on. */
  runtimePort: number;
  /** Soft diagnostics to surface to the user. */
  warnings: string[];
}

export interface RecipeDefinition {
  id: RecipeId;
  version: string;
  label: string;
  description: string;
  /** Default values applied when caller omits a var. */
  defaults: Required<Omit<RecipeVars, "composerFlags" | "installCommand" | "buildCommand" | "appEnv">> & {
    composerFlags: string;
    installCommand: string;
    buildCommand: string;
    appEnv: string;
  };
  render(vars: RecipeVars): RecipeRenderResult;
}
