// SPDX-License-Identifier: AGPL-3.0-only
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tempfile::NamedTempFile;

use ploydok_cli::recovery::{run, AllowNonRoot};

/// Minimal schema — mirrors packages/db/migrations/0000_old_warbound.sql
const SCHEMA: &str = r#"
CREATE TABLE users (
    id                   TEXT    PRIMARY KEY NOT NULL,
    email                TEXT    NOT NULL UNIQUE,
    display_name         TEXT    NOT NULL,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    recovery_token_hash  TEXT,
    recovery_expires_at  INTEGER
);

CREATE TABLE sessions (
    id                  TEXT    PRIMARY KEY NOT NULL,
    user_id             TEXT    NOT NULL,
    refresh_token_hash  TEXT    NOT NULL,
    user_agent          TEXT    NOT NULL,
    ip                  TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    last_seen_at        INTEGER NOT NULL,
    revoked_at          INTEGER,
    expires_at          INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id     TEXT,
    action      TEXT    NOT NULL,
    target_type TEXT    NOT NULL,
    target_id   TEXT    NOT NULL,
    metadata    TEXT    NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    prev_hash   TEXT,
    hash        TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
"#;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn seed_db(conn: &Connection) {
    conn.execute_batch(SCHEMA).expect("schema creation failed");

    let now = now_ms();
    conn.execute(
        "INSERT INTO users (id, email, display_name, created_at, updated_at) \
         VALUES ('user-1', 'admin@example.com', 'Admin', ?1, ?1)",
        [now],
    )
    .unwrap();

    // Two active sessions (revoked_at IS NULL)
    for id in &["sess-1", "sess-2"] {
        conn.execute(
            "INSERT INTO sessions \
             (id, user_id, refresh_token_hash, user_agent, ip, \
              created_at, last_seen_at, expires_at) \
             VALUES (?1, 'user-1', 'hash', 'agent', '127.0.0.1', ?2, ?2, ?3)",
            rusqlite::params![id, now, now + 86_400_000_i64],
        )
        .unwrap();
    }
}

#[test]
fn admin_recovery_happy_path() {
    // Create a temp file — rusqlite will open it as a SQLite DB
    let tmp = NamedTempFile::new().expect("tempfile");
    let db_path = tmp.path().to_path_buf();

    // Seed schema + data
    {
        let conn = Connection::open(&db_path).unwrap();
        seed_db(&conn);
    }

    let before = now_ms();

    // Run recovery (non-root allowed for tests)
    run(&db_path, AllowNonRoot::Yes).expect("recovery::run failed");

    let after = now_ms();

    // Verify state via a fresh connection
    let conn = Connection::open(&db_path).unwrap();

    // recovery_token_hash must be set
    let (token_hash, expires_at): (Option<String>, Option<i64>) = conn
        .query_row(
            "SELECT recovery_token_hash, recovery_expires_at FROM users WHERE id = 'user-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert!(
        token_hash.is_some(),
        "recovery_token_hash must not be NULL after recovery"
    );
    assert!(
        !token_hash.unwrap().is_empty(),
        "recovery_token_hash must not be empty"
    );

    let expires_at = expires_at.expect("recovery_expires_at must not be NULL");
    assert!(
        expires_at > after,
        "recovery_expires_at ({expires_at}) must be in the future (after={after})"
    );
    // Should be roughly now + 15 min
    let expected_min = before + 14 * 60 * 1_000;
    assert!(
        expires_at >= expected_min,
        "expires_at ({expires_at}) should be at least now+14min ({expected_min})"
    );

    // Both sessions must be revoked
    let unrevoked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unrevoked, 0, "all sessions must be revoked");

    let revoked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE revoked_at IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(revoked, 2, "exactly 2 sessions must have revoked_at set");

    // Audit log: exactly 1 EMERGENCY_RECOVERY entry
    let (action, target_type): (String, String) = conn
        .query_row(
            "SELECT action, target_type FROM audit_log WHERE action = 'EMERGENCY_RECOVERY'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(action, "EMERGENCY_RECOVERY");
    assert_eq!(target_type, "user");
}
