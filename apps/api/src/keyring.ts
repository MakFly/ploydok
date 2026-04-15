// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "./env";

// keytar requires libsecret (D-Bus / gnome-keyring) which is unavailable in
// headless CI Linux environments. We lazy-import it so the process doesn't
// crash on import; if the native binding fails we fall back to env.MASTER_KEY
// in dev. In prod, the absence of keytar causes a hard throw.

let cachedKey: string | null = null;

export async function loadMasterKey(): Promise<string> {
  if (cachedKey !== null) {
    return cachedKey;
  }

  if (env.NODE_ENV === "prod") {
    try {
      // Dynamic import to avoid crashing on require at module load time.
      const keytar = await import("keytar");
      const key = await keytar.default.getPassword("ploydok", "master-key");
      if (!key) {
        throw new Error(
          "[keyring] master-key not found in system keyring — run ploydok-cli set-master-key",
        );
      }
      cachedKey = key;
      return cachedKey;
    } catch (err: unknown) {
      // If keytar itself fails to load (missing libsecret) in prod, re-throw.
      throw new Error(`[keyring] failed to load master key from keyring: ${String(err)}`);
    }
  }

  // Dev / test: use env value (auto-generated if absent).
  cachedKey = env.MASTER_KEY;
  return cachedKey;
}
