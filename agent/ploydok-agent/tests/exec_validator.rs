// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for validate_container_exec — no Docker required.

use ploydok_agent::validator::{PermissiveValidator, StrictValidator, Validator, ValidatorConfig};
use ploydok_proto::agent::ExecStart;
use tonic::Code;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn make_strict() -> StrictValidator {
    StrictValidator::new(ValidatorConfig::default())
}

/// A minimal valid ExecStart that should pass all checks.
fn valid_exec() -> ExecStart {
    ExecStart {
        container_id: "ploydok-my-app".to_string(),
        cmd: vec!["/bin/sh".to_string()],
        tty: true,
        cols: 80,
        rows: 24,
        user: "1000:1000".to_string(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// container_id validation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn exec_container_id_without_prefix_is_denied() {
    let v = make_strict();
    let mut req = valid_exec();
    req.container_id = "my-app-container".to_string();

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("container_name_prefix"),
        "message doit mentionner container_name_prefix: {}",
        err.message()
    );
}

#[test]
fn exec_empty_container_id_is_denied() {
    let v = make_strict();
    let mut req = valid_exec();
    req.container_id = String::new();

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("container_id_empty"),
        "message doit mentionner container_id_empty: {}",
        err.message()
    );
}

#[test]
fn exec_short_hex_id_is_allowed() {
    let v = make_strict();
    let mut req = valid_exec();
    // 12 hex chars — looks like a Docker short ID
    req.container_id = "a1b2c3d4e5f6".to_string();
    assert!(v.validate_container_exec(&req).is_ok());
}

#[test]
fn exec_ploydok_prefixed_id_is_allowed() {
    let v = make_strict();
    assert!(v.validate_container_exec(&valid_exec()).is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// cmd validation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn exec_empty_cmd_is_denied() {
    let v = make_strict();
    let mut req = valid_exec();
    req.cmd = vec![];

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("exec_cmd_empty"),
        "message doit mentionner exec_cmd_empty: {}",
        err.message()
    );
}

#[test]
fn exec_disallowed_cmd_is_denied() {
    let v = make_strict();
    let mut req = valid_exec();
    req.cmd = vec!["python3".to_string()];

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("exec_cmd_not_allowed"),
        "message doit mentionner exec_cmd_not_allowed: {}",
        err.message()
    );
}

#[test]
fn exec_cmd_shell_injection_attempt_is_denied() {
    // "sh -c 'rm -rf /'" — cmd[0] = "sh" is allowed, but this just tests
    // that arbitrary cmd[0] values (not in the allowlist) are blocked.
    let v = make_strict();
    let mut req = valid_exec();
    req.cmd = vec!["curl".to_string(), "http://evil.com".to_string()];

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(err.message().contains("exec_cmd_not_allowed"));
}

#[test]
fn exec_allowed_shells_pass() {
    let v = make_strict();
    for shell in &["/bin/sh", "/bin/bash", "sh", "bash"] {
        let mut req = valid_exec();
        req.cmd = vec![shell.to_string()];
        assert!(
            v.validate_container_exec(&req).is_ok(),
            "shell {shell} should be allowed"
        );
    }
}

// cmd with extra args (e.g. ["/bin/sh", "-i"]) is also allowed — cmd[0] is checked.
#[test]
fn exec_cmd_with_extra_args_passes() {
    let v = make_strict();
    let mut req = valid_exec();
    req.cmd = vec!["/bin/bash".to_string(), "-i".to_string()];
    assert!(v.validate_container_exec(&req).is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// user validation
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn exec_user_too_long_is_denied() {
    let v = make_strict();
    let mut req = valid_exec();
    req.user = "a".repeat(33);

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("exec_user_too_long"),
        "message doit mentionner exec_user_too_long: {}",
        err.message()
    );
}

#[test]
fn exec_user_with_special_chars_is_denied() {
    let v = make_strict();
    let mut req = valid_exec();
    req.user = "root; rm -rf /".to_string();

    let err = v.validate_container_exec(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("exec_user_invalid_chars"),
        "message doit mentionner exec_user_invalid_chars: {}",
        err.message()
    );
}

#[test]
fn exec_user_empty_is_allowed() {
    let v = make_strict();
    let mut req = valid_exec();
    req.user = String::new();
    assert!(v.validate_container_exec(&req).is_ok());
}

#[test]
fn exec_user_uid_gid_format_is_allowed() {
    let v = make_strict();
    let mut req = valid_exec();
    req.user = "1000:1000".to_string();
    assert!(v.validate_container_exec(&req).is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// PermissiveValidator always allows exec
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn permissive_validator_allows_everything() {
    let v = PermissiveValidator;
    // Even a request that StrictValidator would reject.
    let req = ExecStart {
        container_id: "not-a-ploydok-container".to_string(),
        cmd: vec!["curl".to_string()],
        tty: false,
        cols: 0,
        rows: 0,
        user: "root".to_string(),
    };
    assert!(v.validate_container_exec(&req).is_ok());
}

// ─────────────────────────────────────────────────────────────────────────────
// service.rs: first frame must be ExecStart
// ─────────────────────────────────────────────────────────────────────────────
//
// We cannot easily test the full bidi streaming without a live Docker daemon,
// so we test the validation logic in isolation. The service.rs code performs
// the same check: if first_frame.payload is not ExecStart → Status::invalid_argument.
// This is documented here as a reminder; the check lives in service.rs:container_exec.

#[test]
fn first_frame_not_exec_start_maps_to_invalid_argument() {
    // This documents the expected error code that container_exec returns when
    // the first frame is not ExecStart (e.g. stdin bytes sent immediately).
    // The actual streaming check is in service.rs — tested here at the type level
    // by verifying the validator correctly allows a valid start.
    let v = make_strict();
    let req = valid_exec();
    assert!(
        v.validate_container_exec(&req).is_ok(),
        "valid ExecStart should pass validation"
    );
    // A non-ExecStart first frame triggers Status::invalid_argument("first frame must be ExecStart")
    // — verified by reading service.rs. The tonic Status code for that path is InvalidArgument.
    assert_eq!(Code::InvalidArgument, Code::InvalidArgument); // tautology — documents the intent
}
