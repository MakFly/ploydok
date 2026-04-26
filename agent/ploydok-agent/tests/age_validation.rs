// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::validator::validate_age_recipient — pinned
// because the input is interpolated into a shell pipeline inside the
// container, so any regression on this validator becomes a command-injection
// vector.

use tonic::Code;

use ploydok_agent::validator::validate_age_recipient;

/// 62-char realistic-shaped age1 recipient (X25519). Not a real key.
fn good() -> String {
    let mut s = String::from("age1");
    s.push_str(&"q".repeat(58));
    s
}

#[test]
fn accepts_canonical_age1_recipient() {
    assert!(validate_age_recipient(&good()).is_ok());
}

#[test]
fn accepts_lowercase_alphanumeric_body() {
    let r = format!(
        "age1{}{}",
        "abcdefghijkmnopqrstuvwxyz0123456789",
        "qq".repeat(11)
    );
    assert!(validate_age_recipient(&r).is_ok());
}

#[test]
fn rejects_missing_age1_prefix() {
    let err = match validate_age_recipient("ssh-rsa AAAAB3NzaC1yc2EAAAAD") {
        Err(e) => e,
        Ok(()) => panic!("ssh-rsa recipients must be rejected"),
    };
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(err.message().contains("age_recipient_format"));
}

#[test]
fn rejects_dollar_sign_command_substitution() {
    // Classic injection: $(rm -rf /) — would be expanded by `sh -c`.
    let r = format!("age1{}", "$(rm-rf/)".repeat(7));
    let err = match validate_age_recipient(&r) {
        Err(e) => e,
        Ok(()) => panic!("dollar/backtick must be rejected"),
    };
    assert_eq!(err.code(), Code::InvalidArgument);
}

#[test]
fn rejects_backtick_injection() {
    let r = format!("age1{}{}", "`whoami`", "q".repeat(50));
    assert!(validate_age_recipient(&r).is_err());
}

#[test]
fn rejects_space_in_recipient() {
    let r = format!("age1{}{}", "abc def", "q".repeat(50));
    assert!(validate_age_recipient(&r).is_err());
}

#[test]
fn rejects_semicolon_chaining() {
    let r = format!("age1{}{}", "abc;ls", "q".repeat(50));
    assert!(validate_age_recipient(&r).is_err());
}

#[test]
fn rejects_pipe_chaining() {
    let r = format!("age1{}{}", "abc|cat", "q".repeat(50));
    assert!(validate_age_recipient(&r).is_err());
}

#[test]
fn rejects_uppercase_letters() {
    let r = format!("age1{}", "Q".repeat(58));
    let err = match validate_age_recipient(&r) {
        Err(e) => e,
        Ok(()) => panic!("uppercase must be rejected"),
    };
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(err.message().contains("age_recipient_chars"));
}

#[test]
fn rejects_too_short() {
    let r = "age1abc".to_string();
    let err = match validate_age_recipient(&r) {
        Err(e) => e,
        Ok(()) => panic!("too short must be rejected"),
    };
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(err.message().contains("age_recipient_length"));
}

#[test]
fn rejects_too_long() {
    let r = format!("age1{}", "q".repeat(200));
    let err = match validate_age_recipient(&r) {
        Err(e) => e,
        Ok(()) => panic!("too long must be rejected"),
    };
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(err.message().contains("age_recipient_length"));
}

#[test]
fn rejects_empty() {
    assert!(validate_age_recipient("").is_err());
}

#[test]
fn rejects_newline_injection() {
    // Embedding a newline could split shell parsing in unexpected ways.
    let r = format!("age1{}{}", "abc\nrm", "q".repeat(50));
    assert!(validate_age_recipient(&r).is_err());
}
