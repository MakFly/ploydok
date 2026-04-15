// SPDX-License-Identifier: AGPL-3.0-only
use anyhow::{bail, Context, Result};
use base64ct::{Base64UrlUnpadded, Encoding};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db;

/// Controls whether the root guard is enforced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowNonRoot {
    /// Enforce root check (production mode).
    No,
    /// Skip root check (test/CI mode — prints a warning to stderr).
    Yes,
}

/// Entry point for the `admin-recovery` subcommand.
///
/// # Arguments
/// * `db_path`        – path to the SQLite database file
/// * `allow_non_root` – whether to bypass the UID == 0 check
pub fn run(db_path: &Path, allow_non_root: AllowNonRoot) -> Result<()> {
    // 1. Root guard
    #[cfg(unix)]
    {
        let uid = nix::unistd::geteuid().as_raw();
        if uid != 0 {
            match allow_non_root {
                AllowNonRoot::No => {
                    bail!("admin-recovery requires root (run with sudo)");
                }
                AllowNonRoot::Yes => {
                    eprintln!(
                        "WARNING: running as non-root (uid={uid}). \
                         This flag is for testing only — never use in production."
                    );
                }
            }
        }
    }
    #[cfg(not(unix))]
    if allow_non_root == AllowNonRoot::No {
        bail!("admin-recovery requires root (run with sudo)");
    }

    // 2. Open DB
    let conn = db::open(db_path).with_context(|| format!("opening database at {db_path:?}"))?;

    // 3. Generate enrollment token: 32 random bytes → base64url no-padding
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let token = Base64UrlUnpadded::encode_string(&raw);

    // 4. SHA-256 hash of the token (store only the hash)
    let hash_bytes = Sha256::digest(token.as_bytes());
    let token_hash = hex::encode(hash_bytes);

    // 5. Timestamps
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before UNIX epoch")
        .as_millis() as i64;
    let expires_ms = now_ms + 15 * 60 * 1_000; // now + 15 minutes

    // 6. Find oldest user (implicit admin)
    let user_id: String = conn
        .query_row(
            "SELECT id FROM users ORDER BY created_at ASC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .context("no users found in database — has the app been initialised?")?;

    // 7. Set recovery token on that user
    conn.execute(
        "UPDATE users \
         SET recovery_token_hash = ?1, recovery_expires_at = ?2 \
         WHERE id = ?3",
        rusqlite::params![token_hash, expires_ms, user_id],
    )
    .context("updating recovery token on user")?;

    // 8. Revoke all active sessions
    conn.execute(
        "UPDATE sessions SET revoked_at = ?1 WHERE revoked_at IS NULL",
        rusqlite::params![now_ms],
    )
    .context("revoking sessions")?;

    // 9. Audit log entry
    conn.execute(
        "INSERT INTO audit_log \
         (user_id, action, target_type, target_id, metadata, created_at) \
         VALUES (?1, 'EMERGENCY_RECOVERY', 'user', ?2, '{}', ?3)",
        rusqlite::params![user_id, user_id, now_ms],
    )
    .context("inserting audit log entry")?;

    // 10. Print token — the ONLY place it appears in clear text
    println!("RECOVERY TOKEN (valid 15 minutes, shown once): {token}");
    println!("URL: https://<your-instance>/auth/recovery?token={token}");

    Ok(())
}

// hex encode helper (avoids pulling the hex crate by doing it inline)
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
}
