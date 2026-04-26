// SPDX-License-Identifier: AGPL-3.0-only
//
// Validator coverage for the InspectContainerHealth RPC.
//
// The RPC reads Docker's daemon-maintained `State.Health.Status` for a
// container; the only attacker-influenced field is `container_id`, so the
// validator's job is purely to keep that input within the same shape we
// allow elsewhere (sha256 / short-id / `ploydok-` prefix).

use ploydok_agent::validator::{PermissiveValidator, StrictValidator, Validator, ValidatorConfig};
use ploydok_proto::agent::InspectContainerHealthRequest;

fn strict() -> StrictValidator {
    StrictValidator::new(ValidatorConfig::default())
}

fn req(container_id: &str) -> InspectContainerHealthRequest {
    InspectContainerHealthRequest {
        container_id: container_id.to_string(),
    }
}

#[test]
fn accepts_ploydok_prefixed_name() {
    let v = strict();
    v.validate_inspect_container_health(&req("ploydok-app-smoke-symfony"))
        .expect("ploydok-prefixed name must be allowed");
}

#[test]
fn accepts_sha256_digest() {
    let v = strict();
    v.validate_inspect_container_health(&req(
        "sha256:4c917a709637ce391e2d4a805336200affa91d6c4e5f694dbda78aa3749f4923",
    ))
    .expect("sha256 digest must be allowed");
}

#[test]
fn accepts_short_id() {
    let v = strict();
    // 12 lowercase hex chars — the canonical Docker short-id form.
    v.validate_inspect_container_health(&req("abc123ef9012"))
        .expect("12-char hex short id must be allowed");
}

#[test]
fn rejects_empty_container_id() {
    let v = strict();
    let err = v
        .validate_inspect_container_health(&req(""))
        .expect_err("empty container_id must be rejected");
    assert_eq!(err.code(), tonic::Code::InvalidArgument);
    assert!(
        err.message().contains("container_id_empty"),
        "expected rule container_id_empty, got: {}",
        err.message()
    );
}

#[test]
fn rejects_arbitrary_name() {
    let v = strict();
    // No `ploydok-` prefix, no sha256, not a 12-char hex id → must be
    // refused so a compromised API can't poll arbitrary host containers.
    let err = v
        .validate_inspect_container_health(&req("evil-container"))
        .expect_err("arbitrary container name must be rejected");
    assert_eq!(err.code(), tonic::Code::PermissionDenied);
    assert!(
        err.message().contains("container_name_prefix"),
        "expected rule container_name_prefix, got: {}",
        err.message()
    );
}

#[test]
fn permissive_accepts_anything() {
    let v = PermissiveValidator;
    v.validate_inspect_container_health(&req(""))
        .expect("permissive accepts empty");
    v.validate_inspect_container_health(&req("evil-container"))
        .expect("permissive accepts arbitrary name");
}
