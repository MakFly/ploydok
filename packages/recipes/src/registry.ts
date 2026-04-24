// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeId } from "@ploydok/shared"
import type { RecipeDefinition } from "./types"
import { phpLaravelV1 } from "./recipes/php-laravel-v1"
import { phpSymfonyV1 } from "./recipes/php-symfony-v1"
import { phpSymfonyFrankenphpV1 } from "./recipes/php-symfony-frankenphp-v1"
import { phpGenericV1 } from "./recipes/php-generic-v1"

const REGISTRY: Record<RecipeId, RecipeDefinition> = {
  "php-laravel.v1": phpLaravelV1,
  "php-symfony.v1": phpSymfonyV1,
  "php-symfony-frankenphp.v1": phpSymfonyFrankenphpV1,
  "php-generic.v1": phpGenericV1,
}

export function getRecipe(id: RecipeId): RecipeDefinition {
  const r = REGISTRY[id]
  if (!r) throw new Error(`Unknown recipe: ${id}`)
  return r
}

export function listRecipes(): Array<RecipeDefinition> {
  return Object.values(REGISTRY)
}
