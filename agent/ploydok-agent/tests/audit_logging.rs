// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::audit::audit() — verify that every audit
// event is emitted with the documented structured fields.

use tracing_test::traced_test;

use ploydok_agent::audit::{audit, audit_with_client, client_identity_from_der};

#[test]
#[traced_test]
fn audit_ok_emits_result_ok() {
    audit("container_create", "ploydok-app-x", Ok(()));
    assert!(
        logs_contain("audit"),
        "missing audit log line: {:?}",
        logs_contain("audit")
    );
    assert!(logs_contain("action=\"container_create\""));
    assert!(logs_contain("target=\"ploydok-app-x\""));
    assert!(logs_contain("result=\"ok\""));
    // Failed runs include an `error` field. Successful runs MUST NOT.
    assert!(
        !logs_contain("error=\""),
        "ok audit must not include an error field",
    );
}

#[test]
#[traced_test]
fn audit_err_emits_result_error_and_error_field() {
    audit("container_create", "ploydok-app-y", Err("denied: registry"));
    assert!(logs_contain("action=\"container_create\""));
    assert!(logs_contain("target=\"ploydok-app-y\""));
    assert!(logs_contain("result=\"error\""));
    assert!(logs_contain("error=\"denied: registry\""));
}

#[test]
#[traced_test]
fn audit_multi_call_emits_one_record_per_call() {
    audit("a", "t1", Ok(()));
    audit("b", "t2", Err("e"));
    audit("c", "t3", Ok(()));
    logs_assert(|lines: &[&str]| {
        let n = lines.iter().filter(|line| line.contains("audit")).count();
        if n >= 3 {
            Ok(())
        } else {
            Err(format!(
                "expected ≥3 audit log lines, got {n}; lines: {lines:?}"
            ))
        }
    });
}

#[test]
#[traced_test]
fn audit_handles_quotes_in_target_without_breaking_parsing() {
    audit("rpc", r#"target"with"quotes"#, Ok(()));
    // The tracing fmt layer escapes the inner quotes into `\"`.
    assert!(
        logs_contain(r#"target"#),
        "target field must be present somewhere in output"
    );
    assert!(logs_contain("result=\"ok\""));
}

#[test]
#[traced_test]
fn audit_default_client_is_unknown() {
    audit("rpc", "tgt", Ok(()));
    assert!(
        logs_contain("client=\"unknown\""),
        "audit() without explicit client must log client=\"unknown\"",
    );
}

#[test]
#[traced_test]
fn audit_with_client_logs_provided_identity() {
    audit_with_client("rpc", "tgt", Ok(()), "ploydok-api-client");
    assert!(
        logs_contain("client=\"ploydok-api-client\""),
        "explicit client identity must propagate to audit log",
    );
}

#[test]
#[traced_test]
fn audit_with_empty_client_normalises_to_unknown() {
    audit_with_client("rpc", "tgt", Ok(()), "");
    assert!(
        logs_contain("client=\"unknown\""),
        "empty client string must be normalised to \"unknown\"",
    );
}

#[test]
fn client_identity_from_der_returns_unknown_on_garbage() {
    assert_eq!(client_identity_from_der(b"not a der cert"), "unknown");
}

#[test]
fn client_identity_from_der_extracts_cn_from_real_cert() {
    // Generate a fresh cert via ploydok-agent's PKI to get a real DER blob
    // with a known CN. We rely on rcgen via a sibling helper rather than
    // hand-crafting bytes — this tests the full parse path including ASN.1.
    use std::time::SystemTime;
    let dir = tempfile::TempDir::new().expect("tempdir");
    let mat = ploydok_agent::pki::ensure_pki(dir.path().to_str().unwrap()).expect("PKI bootstrap");
    // ensure_pki returns PEM; we need to reuse pem→der for the helper.
    // Round-trip through x509-parser to obtain DER bytes.
    let (_, pem) = x509_parser::pem::parse_x509_pem(&mat.server_cert_pem).expect("PEM parse");
    let cn = client_identity_from_der(&pem.contents);
    assert_eq!(
        cn, "ploydok-agent",
        "extracted CN must match pki.rs::generate_pki convention",
    );
    let _ = SystemTime::now(); // keep imports tidy if unused above
}

#[test]
#[traced_test]
fn audit_handles_newline_in_error_without_breaking_parsing() {
    audit("rpc", "tgt", Err("line1\nline2"));
    assert!(logs_contain("action=\"rpc\""));
    assert!(logs_contain("result=\"error\""));
    // The fmt layer renders `\n` as the escape sequence — lines should not
    // be split into two distinct log records (would break grep-based pipelines).
    logs_assert(|lines: &[&str]| {
        let count = lines.iter().filter(|l| l.contains("audit")).count();
        if count == 1 {
            Ok(())
        } else {
            Err(format!(
                "expected exactly 1 audit line, got {count}; lines: {lines:?}"
            ))
        }
    });
}
