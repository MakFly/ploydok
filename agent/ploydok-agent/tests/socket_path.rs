// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::socket_config::validate_socket_path.

use std::path::Path;

use ploydok_agent::socket_config::{validate_socket_path, ALLOWED_SOCKET_DIRS};

#[test]
fn accepts_socket_under_run_ploydok() {
    validate_socket_path(Path::new("/run/ploydok/agent.sock"), ALLOWED_SOCKET_DIRS)
        .expect("/run/ploydok/agent.sock must be accepted");
}

#[test]
fn accepts_socket_under_tmp_ploydok() {
    validate_socket_path(Path::new("/tmp/ploydok/agent.sock"), ALLOWED_SOCKET_DIRS)
        .expect("/tmp/ploydok/agent.sock must be accepted");
}

#[test]
fn accepts_socket_under_var_run_ploydok() {
    validate_socket_path(
        Path::new("/var/run/ploydok/agent.sock"),
        ALLOWED_SOCKET_DIRS,
    )
    .expect("/var/run/ploydok/agent.sock must be accepted");
}

#[test]
fn rejects_path_outside_whitelist() {
    let err = validate_socket_path(Path::new("/etc/shadow"), ALLOWED_SOCKET_DIRS)
        .expect_err("path outside whitelist must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("must live directly under"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn rejects_parent_dir_traversal() {
    let err = validate_socket_path(Path::new("/tmp/ploydok/../etc/shadow"), ALLOWED_SOCKET_DIRS)
        .expect_err("path with `..` must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("must not contain `..`"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn rejects_root_path() {
    let err = validate_socket_path(Path::new("/"), ALLOWED_SOCKET_DIRS)
        .expect_err("`/` has no parent and must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("has no parent directory"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn rejects_indirect_parent() {
    // Subdirectory under a whitelisted root → parent ≠ exact whitelist entry.
    let err = validate_socket_path(
        Path::new("/tmp/ploydok/sub/agent.sock"),
        ALLOWED_SOCKET_DIRS,
    )
    .expect_err("nested subdirectory must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("must live directly under"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn rejects_empty_path() {
    let err = validate_socket_path(Path::new(""), ALLOWED_SOCKET_DIRS)
        .expect_err("empty path must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("must not be empty"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn rejects_relative_path() {
    let err = validate_socket_path(Path::new("./agent.sock"), ALLOWED_SOCKET_DIRS)
        .expect_err("relative path with CurDir must be rejected (parent `.` not whitelisted)");
    let msg = err.to_string();
    assert!(
        msg.contains("must live directly under"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn rejects_bare_filename() {
    let err = validate_socket_path(Path::new("agent.sock"), ALLOWED_SOCKET_DIRS)
        .expect_err("bare filename has empty parent and must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("must live directly under"),
        "unexpected error message: {msg}",
    );
}

#[test]
fn accepts_with_custom_whitelist() {
    let custom: &[&str] = &["/opt/ploydok/sockets"];
    validate_socket_path(Path::new("/opt/ploydok/sockets/agent.sock"), custom)
        .expect("custom whitelist must be honored");
}

#[test]
fn rejects_default_whitelist_path_with_custom_only() {
    // /tmp/ploydok is in the default whitelist but not in the custom one — the
    // function must respect the custom whitelist exactly.
    let custom: &[&str] = &["/opt/ploydok/sockets"];
    let err = validate_socket_path(Path::new("/tmp/ploydok/agent.sock"), custom)
        .expect_err("custom whitelist must override defaults");
    let msg = err.to_string();
    assert!(
        msg.contains("must live directly under"),
        "unexpected error message: {msg}",
    );
}
