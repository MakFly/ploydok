// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stripe cannot send Ploydok's browser CSRF token. Only its exact signed
 * webhook endpoint is exempt; sibling paths and other methods remain covered
 * by the global double-submit protection.
 */
export function isStripeWebhookRequest(method: string, path: string): boolean {
  return method === "POST" && path === "/stripe"
}
