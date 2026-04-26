// SPDX-License-Identifier: AGPL-3.0-only
//
// Boot-time guards. Pure functions extracted from `main.rs` so the
// security-sensitive policies can be unit-tested in isolation.

/// Names of environment variables that, if set to a production value,
/// MUST cause the agent to refuse to start in `PLOYDOK_AGENT_INSECURE=1`
/// mode. Both are recognised so deployments using the convention of either
/// ecosystem (Rust / Node) get the same protection.
pub const PROD_ENV_KEYS: &[&str] = &["PLOYDOK_ENV", "NODE_ENV"];

/// Values considered "production". Comparison is case-insensitive.
pub const PROD_ENV_VALUES: &[&str] = &["prod", "production"];

/// Decide whether the current environment looks like production by inspecting
/// `env_value(key)` for each `PROD_ENV_KEYS`. `env_value` is parameterised so
/// tests can inject a fake env without touching the process state.
pub fn looks_like_production(env_value: impl Fn(&str) -> Option<String>) -> bool {
    PROD_ENV_KEYS.iter().any(|key| {
        env_value(key)
            .map(|v| {
                let v = v.trim().to_ascii_lowercase();
                PROD_ENV_VALUES.contains(&v.as_str())
            })
            .unwrap_or(false)
    })
}

/// Refuse to boot in insecure mode (`PLOYDOK_AGENT_INSECURE=1`) when the
/// environment advertises production. mTLS is the only real auth gate; if
/// `INSECURE=1` ships to prod by accident the socket becomes a fully-open
/// Docker control plane.
///
/// `env_value` is the same indirection used by `looks_like_production` so
/// the function is fully testable.
pub fn assert_insecure_safe_for_env(
    insecure: bool,
    env_value: impl Fn(&str) -> Option<String>,
) -> anyhow::Result<()> {
    if !insecure {
        return Ok(());
    }
    if looks_like_production(env_value) {
        anyhow::bail!(
            "PLOYDOK_AGENT_INSECURE=1 refused: PLOYDOK_ENV/NODE_ENV indicates production. \
             Insecure mode disables mTLS — never enable it in production."
        );
    }
    Ok(())
}

/// Convenience wrapper that reads from the real process environment.
pub fn assert_insecure_safe_from_process_env(insecure: bool) -> anyhow::Result<()> {
    assert_insecure_safe_for_env(insecure, |key| std::env::var(key).ok())
}
