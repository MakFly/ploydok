// SPDX-License-Identifier: AGPL-3.0-only
//
// Pure helpers for the agent's Unix socket bootstrap. Extracted from `main.rs`
// so the path-validation logic can be unit-tested without spinning up the
// gRPC server.

use std::path::{Component, Path};

/// Directories the agent's Unix socket is allowed to live directly under.
///
/// Prevents a hostile or misconfigured `PLOYDOK_AGENT_SOCKET` from pointing
/// the subsequent `remove_file()` / `bind()` / `chmod()` chain at a sensitive
/// host path. The agent runs as root inside its container, so anything is
/// reachable from the socket parent otherwise.
pub const ALLOWED_SOCKET_DIRS: &[&str] = &["/run/ploydok", "/tmp/ploydok", "/var/run/ploydok"];

/// Validate a socket path without canonicalizing — the file may not exist yet.
///
/// Returns an error when:
/// - the path is empty,
/// - the path contains any `..` component (closes the obvious path-traversal
///   vector through `PLOYDOK_AGENT_SOCKET`),
/// - the path has no parent (e.g. `/`),
/// - the parent is not exactly one of `allowed_dirs`.
///
/// Pass [`ALLOWED_SOCKET_DIRS`] in production. Tests can inject a tempdir.
pub fn validate_socket_path(path: &Path, allowed_dirs: &[&str]) -> anyhow::Result<()> {
    if path.as_os_str().is_empty() {
        anyhow::bail!("PLOYDOK_AGENT_SOCKET must not be empty");
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        anyhow::bail!(
            "PLOYDOK_AGENT_SOCKET={} must not contain `..`",
            path.display()
        );
    }
    let parent = path.parent().ok_or_else(|| {
        anyhow::anyhow!(
            "PLOYDOK_AGENT_SOCKET={} has no parent directory",
            path.display()
        )
    })?;
    if !allowed_dirs
        .iter()
        .any(|allowed| parent == Path::new(allowed))
    {
        anyhow::bail!(
            "PLOYDOK_AGENT_SOCKET={} must live directly under one of {:?}",
            path.display(),
            allowed_dirs
        );
    }
    Ok(())
}
