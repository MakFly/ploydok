// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan → resource limits mapping. `custom` disables enforcement (legacy apps
 * backfilled to `custom` by migration 0001_sprint3bis_foundation).
 */
export const PLANS = {
  nano: { cpu: 0.25, memMB: 256, pids: 128 },
  small: { cpu: 0.5, memMB: 512, pids: 256 },
  medium: { cpu: 1, memMB: 1024, pids: 512 },
  large: { cpu: 2, memMB: 2048, pids: 1024 },
  custom: null,
} as const;

export type PlanName = keyof typeof PLANS;
export const PLAN_NAMES = Object.keys(PLANS) as PlanName[];

export type PlanLimits = NonNullable<(typeof PLANS)[Exclude<PlanName, 'custom'>]>;

/** Resource limits for a plan; null means "no enforcement" (custom plan). */
export function limitsForPlan(plan: PlanName): PlanLimits | null {
  return PLANS[plan];
}
