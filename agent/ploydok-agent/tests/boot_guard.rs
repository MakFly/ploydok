// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::boot_guard — pinned because this is the
// last-line defense against shipping `PLOYDOK_AGENT_INSECURE=1` to prod.

use ploydok_agent::boot_guard::{assert_insecure_safe_for_env, looks_like_production};

fn empty(_: &str) -> Option<String> {
    None
}

fn from(
    pairs: &'static [(&'static str, &'static str)],
) -> impl Fn(&str) -> Option<String> + 'static {
    move |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
    }
}

#[test]
fn looks_like_production_false_when_env_unset() {
    assert!(!looks_like_production(empty));
}

#[test]
fn looks_like_production_true_for_ploydok_env_prod() {
    let f = from(&[("PLOYDOK_ENV", "prod")]);
    assert!(looks_like_production(f));
}

#[test]
fn looks_like_production_true_for_node_env_production() {
    let f = from(&[("NODE_ENV", "production")]);
    assert!(looks_like_production(f));
}

#[test]
fn looks_like_production_case_insensitive() {
    let f = from(&[("PLOYDOK_ENV", "PROD")]);
    assert!(looks_like_production(f));
}

#[test]
fn looks_like_production_false_for_dev() {
    let f = from(&[("PLOYDOK_ENV", "dev"), ("NODE_ENV", "development")]);
    assert!(!looks_like_production(f));
}

#[test]
fn assert_insecure_safe_passes_when_secure_in_prod() {
    let f = from(&[("PLOYDOK_ENV", "prod")]);
    assert!(assert_insecure_safe_for_env(false, f).is_ok());
}

#[test]
fn assert_insecure_safe_passes_when_insecure_in_dev() {
    let f = from(&[("PLOYDOK_ENV", "dev")]);
    assert!(assert_insecure_safe_for_env(true, f).is_ok());
}

#[test]
fn assert_insecure_safe_blocks_insecure_in_prod() {
    let f = from(&[("PLOYDOK_ENV", "prod")]);
    let err = match assert_insecure_safe_for_env(true, f) {
        Err(e) => e,
        Ok(()) => panic!("INSECURE=1 in prod must be refused"),
    };
    let msg = format!("{err:#}");
    assert!(
        msg.contains("refused") && msg.contains("production"),
        "wrong error message: {msg}",
    );
}

#[test]
fn assert_insecure_safe_blocks_insecure_when_node_env_production() {
    let f = from(&[("NODE_ENV", "production")]);
    assert!(assert_insecure_safe_for_env(true, f).is_err());
}

#[test]
fn assert_insecure_safe_passes_when_no_env_set() {
    // Defaults: env unset → not production → insecure allowed.
    assert!(assert_insecure_safe_for_env(true, empty).is_ok());
}

#[test]
fn assert_insecure_safe_ignores_unrelated_env_keys() {
    let f = from(&[("UNRELATED_VAR", "production")]);
    assert!(assert_insecure_safe_for_env(true, f).is_ok());
}

#[test]
fn assert_insecure_safe_blocks_with_whitespace_value() {
    let f = from(&[("PLOYDOK_ENV", "  prod  ")]);
    assert!(assert_insecure_safe_for_env(true, f).is_err());
}
