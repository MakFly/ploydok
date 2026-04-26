// SPDX-License-Identifier: AGPL-3.0-only
//
// Structured audit logging.
//
// Every RPC calls `audit(action, target, result)` at entry and exit.
// Task 2.3/2.4 will redirect these records to an `audit_log` DB table; for now
// they are emitted as JSON log lines via `tracing`.

use tracing::info;
use x509_parser::prelude::FromDer;

/// Log a single audit event.
///
/// # Arguments
/// * `action` — RPC name, e.g. `"container_create"`.
/// * `target` — Primary identifier (container name/id, image ref, …).
/// * `result` — `Ok(())` on success, `Err(reason)` on failure/rejection.
///
/// The `client` field is logged from the calling-side context; pass `""` from
/// untraced internal call sites and a meaningful identity (mTLS CN, "insecure_mode",
/// "system") from request-driven sites. Empty values are normalised to `"unknown"`.
pub fn audit(action: &str, target: &str, result: Result<(), &str>) {
    audit_with_client(action, target, result, "");
}

/// Variant of [`audit`] that carries a `client` identifier (typically the CN
/// of the mTLS client cert, or `"insecure_mode"` in dev). Use this from RPC
/// handlers that have access to the tonic `Request`.
pub fn audit_with_client(action: &str, target: &str, result: Result<(), &str>, client: &str) {
    let client = if client.is_empty() { "unknown" } else { client };
    let (result_str, error) = match result {
        Ok(()) => ("ok", None),
        Err(e) => ("error", Some(e)),
    };

    match error {
        None => info!(
            action = action,
            target = target,
            result = result_str,
            client = client,
            "audit"
        ),
        Some(e) => info!(
            action = action,
            target = target,
            result = result_str,
            client = client,
            error = e,
            "audit"
        ),
    }
}

/// Extract a client identifier from a tonic `Request`.
///
/// Returns:
/// - the X.509 Common Name of the first peer cert when mTLS is in use,
/// - `"insecure_mode"` when there are no peer certs (dev `PLOYDOK_AGENT_INSECURE=1`),
/// - `"no_cn"` when the cert has no CN attribute,
/// - `"unknown"` when DER parsing fails.
///
/// This helper is the canonical way for handlers to feed [`audit_with_client`]:
/// it never panics and always returns a non-empty string.
pub fn client_identity_from_request<T>(request: &tonic::Request<T>) -> String {
    let Some(certs) = request.peer_certs() else {
        return "insecure_mode".to_string();
    };
    let Some(first) = certs.first() else {
        return "unknown".to_string();
    };
    client_identity_from_der(first.as_ref())
}

/// Inner helper exposed for tests: derive the client identity from a single
/// DER-encoded certificate. Returns the same labels as
/// [`client_identity_from_request`] minus `"insecure_mode"`.
pub fn client_identity_from_der(der: &[u8]) -> String {
    match x509_parser::certificate::X509Certificate::from_der(der) {
        Ok((_, cert)) => cert
            .subject()
            .iter_common_name()
            .next()
            .and_then(|cn| cn.as_str().ok().map(|s| s.to_string()))
            .unwrap_or_else(|| "no_cn".to_string()),
        Err(_) => "unknown".to_string(),
    }
}
