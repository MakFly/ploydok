// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "./env";

// keytar requires libsecret (D-Bus / gnome-keyring), which is unavailable in
// most headless container installs. We prefer the system keyring when it works,
// but production installers also provision MASTER_KEY specifically for this
// headless path.

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
      if (key) {
        cachedKey = key;
        return cachedKey;
      }
      if (!env.MASTER_KEY) {
        throw new Error(
          "[keyring] master-key not found in system keyring and MASTER_KEY is unset",
        );
      }
      cachedKey = env.MASTER_KEY;
      return cachedKey;
    } catch (err: unknown) {
      if (env.MASTER_KEY) {
        cachedKey = env.MASTER_KEY;
        return cachedKey;
      }
      throw new Error(
        `[keyring] failed to load master key from keyring and MASTER_KEY is unset: ${String(err)}`,
      );
    }
  }

  // Dev / test: use env value (auto-generated if absent).
  cachedKey = env.MASTER_KEY;
  return cachedKey;
}
