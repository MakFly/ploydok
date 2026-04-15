// SPDX-License-Identifier: AGPL-3.0-only
//
// Structured audit logging.
//
// Every RPC calls `audit(action, target, result)` at entry and exit.
// Task 2.3/2.4 will redirect these records to an `audit_log` DB table; for now
// they are emitted as JSON log lines via `tracing`.

use tracing::info;

/// Log a single audit event.
///
/// # Arguments
/// * `action` — RPC name, e.g. `"container_create"`.
/// * `target` — Primary identifier (container name/id, image ref, …).
/// * `result` — `Ok(())` on success, `Err(reason)` on failure/rejection.
pub fn audit(action: &str, target: &str, result: Result<(), &str>) {
    let (result_str, error) = match result {
        Ok(()) => ("ok", None),
        Err(e) => ("error", Some(e)),
    };

    match error {
        None => info!(
            action = action,
            target = target,
            result = result_str,
            "audit"
        ),
        Some(e) => info!(
            action = action,
            target = target,
            result = result_str,
            error = e,
            "audit"
        ),
    }
}
