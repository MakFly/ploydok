// SPDX-License-Identifier: AGPL-3.0-only
use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

/// Open a SQLite database at the given path.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    // Enable WAL for better concurrent access
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}
