// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ValidatorConfig parsing and StrictValidator::from_env().
//
// These tests mutate the process environment via PLOYDOK_VALIDATOR_CONFIG so
// they MUST be serialised — otherwise concurrent tests interleave their env
// changes and produce flaky results. `#[serial]` from `serial_test` enforces
// that.

use std::io::Write;

use serial_test::serial;
use tempfile::NamedTempFile;

use ploydok_agent::validator::{StrictValidator, ValidatorConfig};

const ENV_KEY: &str = "PLOYDOK_VALIDATOR_CONFIG";

fn clear_env() {
    // SAFETY: process-global env mutation, gated by `#[serial]`.
    unsafe {
        std::env::remove_var(ENV_KEY);
    }
}

fn set_env(path: &str) {
    // SAFETY: process-global env mutation, gated by `#[serial]`.
    unsafe {
        std::env::set_var(ENV_KEY, path);
    }
}

fn write_temp(suffix: &str, content: &str) -> NamedTempFile {
    let mut f = tempfile::Builder::new()
        .suffix(suffix)
        .tempfile()
        .expect("create tempfile");
    f.write_all(content.as_bytes())
        .expect("write tempfile content");
    f.flush().expect("flush tempfile");
    f
}

#[test]
fn default_config_uses_documented_constants() {
    let cfg = ValidatorConfig::default();
    assert_eq!(cfg.max_cpu, 4.0, "default max_cpu drifted");
    assert_eq!(
        cfg.max_memory_bytes,
        8i64 * 1024 * 1024 * 1024,
        "default max_memory_bytes drifted"
    );
    assert_eq!(cfg.volume_prefix, "/var/lib/ploydok/volumes");
    assert!(
        cfg.allowed_registries
            .iter()
            .any(|r| r == "registry.ploydok.io"),
        "default allowed_registries must include registry.ploydok.io",
    );
}

#[test]
#[serial]
fn from_env_without_var_returns_defaults() {
    clear_env();
    let result = StrictValidator::from_env();
    assert!(result.is_ok(), "from_env without var must succeed");
}

#[test]
#[serial]
fn from_env_loads_valid_toml() {
    clear_env();
    let toml = r#"
allowed_registries = ["registry.example.com"]
volume_prefix = "/var/lib/example/volumes"
max_cpu = 2.0
max_memory_bytes = 1073741824
"#;
    let f = write_temp(".toml", toml);
    set_env(f.path().to_str().unwrap());
    let result = StrictValidator::from_env();
    clear_env();
    assert!(result.is_ok(), "valid TOML must parse");
}

#[test]
#[serial]
fn from_env_loads_valid_json() {
    clear_env();
    let json = r#"{
        "allowed_registries": ["registry.example.com"],
        "volume_prefix": "/var/lib/example/volumes",
        "max_cpu": 2.0,
        "max_memory_bytes": 1073741824
    }"#;
    let f = write_temp(".json", json);
    set_env(f.path().to_str().unwrap());
    let result = StrictValidator::from_env();
    clear_env();
    assert!(result.is_ok(), "valid JSON must parse");
}

#[test]
#[serial]
fn from_env_errors_on_missing_file() {
    clear_env();
    set_env("/tmp/ploydok-test-this-file-does-not-exist-xyz.toml");
    let result = StrictValidator::from_env();
    clear_env();
    let err = match result {
        Ok(_) => panic!("missing file must error"),
        Err(e) => e,
    };
    let msg = format!("{err:#}");
    assert!(
        msg.to_lowercase().contains("no such") || msg.to_lowercase().contains("not found"),
        "missing-file error must mention missing file, got: {msg}",
    );
}

#[test]
#[serial]
fn from_env_errors_on_malformed_toml() {
    clear_env();
    let f = write_temp(".toml", "this = is = not valid toml [[[");
    set_env(f.path().to_str().unwrap());
    let result = StrictValidator::from_env();
    clear_env();
    assert!(result.is_err(), "malformed TOML must error");
}

#[test]
#[serial]
fn from_env_errors_on_malformed_json() {
    clear_env();
    let f = write_temp(".json", "{not valid json");
    set_env(f.path().to_str().unwrap());
    let result = StrictValidator::from_env();
    clear_env();
    assert!(result.is_err(), "malformed JSON must error");
}

#[test]
#[serial]
fn from_env_accepts_negative_max_cpu_documenting_lack_of_validation() {
    // Negative max_cpu is semantically wrong but the loader does NOT reject it.
    // This test pins that behavior so a future "add validation" change is
    // intentional — and so reviewers see the gap.
    clear_env();
    let toml = r#"
max_cpu = -1.0
max_memory_bytes = 1073741824
"#;
    let f = write_temp(".toml", toml);
    set_env(f.path().to_str().unwrap());
    let result = StrictValidator::from_env();
    clear_env();
    assert!(
        result.is_ok(),
        "loader currently accepts negative max_cpu — see test name",
    );
}

#[test]
#[serial]
fn from_env_accepts_extreme_max_memory_bytes() {
    clear_env();
    let toml = format!(
        r#"
max_cpu = 4.0
max_memory_bytes = {}
"#,
        i64::MAX
    );
    let f = write_temp(".toml", &toml);
    set_env(f.path().to_str().unwrap());
    let result = StrictValidator::from_env();
    clear_env();
    assert!(result.is_ok(), "i64::MAX must parse without overflow");
}

#[test]
fn config_default_serializes_roundtrip_through_json() {
    // Sanity: the default config can be serialized and re-parsed identically.
    // Catches accidental skips of `Serialize`/`Deserialize` derives.
    let cfg = ValidatorConfig::default();
    let json = serde_json::to_string(&cfg).expect("serialize default");
    let cfg2: ValidatorConfig = serde_json::from_str(&json).expect("re-parse JSON");
    assert_eq!(cfg.max_cpu, cfg2.max_cpu);
    assert_eq!(cfg.max_memory_bytes, cfg2.max_memory_bytes);
    assert_eq!(cfg.volume_prefix, cfg2.volume_prefix);
    assert_eq!(cfg.allowed_registries, cfg2.allowed_registries);
}
