// SPDX-License-Identifier: AGPL-3.0-only
import type { RecipeId } from "@ploydok/shared";
import { getRecipe } from "./registry";
import type { RecipeRenderResult, RecipeVars } from "./types";

export * from "./types";
export { getRecipe, listRecipes } from "./registry";
export { isProductionAppEnv } from "./env";

/**
 * Renders a recipe into a set of files to inject into the build context.
 * Caller is responsible for honoring the collision policy: do NOT overwrite
 * user-provided files of the same name (e.g. if the user shipped a Dockerfile,
 * route to buildMethod="dockerfile" instead of "recipe" at the wizard step).
 */
export function renderRecipe(id: RecipeId, vars: RecipeVars = {}): RecipeRenderResult {
  return getRecipe(id).render(vars);
}
