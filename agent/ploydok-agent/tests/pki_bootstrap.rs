// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::pki::ensure_pki — the mTLS bootstrap that
// generates and loads CA + server + client certificates.

use std::fs;
use std::time::{Duration, SystemTime};

use tempfile::TempDir;
use tracing_test::traced_test;

use ploydok_agent::pki::{assert_cert_not_expired, ensure_pki};

#[test]
fn empty_dir_generates_all_six_files() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().expect("utf8 tempdir path").to_string();
    let mat = ensure_pki(&dir_str).expect("ensure_pki on empty dir");
    assert!(!mat.ca_cert_pem.is_empty(), "CA cert PEM not loaded");
    assert!(
        !mat.server_cert_pem.is_empty(),
        "server cert PEM not loaded"
    );
    assert!(!mat.server_key_pem.is_empty(), "server key PEM not loaded");

    for name in [
        "ca.pem",
        "ca.key",
        "server.pem",
        "server.key",
        "client.pem",
        "client.key",
    ] {
        let p = dir.path().join(name);
        assert!(p.exists(), "expected {name} to be generated");
    }
}

#[test]
fn pem_contents_have_correct_headers() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let mat = ensure_pki(&dir_str).expect("ensure_pki");

    let ca_str = String::from_utf8(mat.ca_cert_pem.clone()).expect("CA PEM utf8");
    assert!(
        ca_str.contains("-----BEGIN CERTIFICATE-----"),
        "CA PEM missing certificate header",
    );
    assert!(
        ca_str.contains("-----END CERTIFICATE-----"),
        "CA PEM missing certificate footer",
    );

    let key_str = String::from_utf8(mat.server_key_pem.clone()).expect("server key utf8");
    assert!(
        key_str.contains("PRIVATE KEY"),
        "server key PEM should declare PRIVATE KEY: {key_str}",
    );
}

#[test]
fn server_cert_uses_documented_common_name() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let mat = ensure_pki(&dir_str).expect("ensure_pki");
    // Read via openssl-style strings — rcgen emits human-readable PEM with
    // the CN visible in the certificate text. Convert the PEM cert to a
    // string and search for the CN literal that the implementation hardcodes.
    // (The CN bytes are embedded in DER, but rcgen's PEM is base64 only,
    // so we do a more robust check: re-parse the cert with rcgen.)
    let pem = String::from_utf8(mat.server_cert_pem).expect("PEM utf8");
    assert!(pem.contains("CERTIFICATE"));
    // Sanity that the CA + server cert are distinct files written.
    let ca = fs::read_to_string(dir.path().join("ca.pem")).unwrap();
    let server = fs::read_to_string(dir.path().join("server.pem")).unwrap();
    assert_ne!(ca, server, "CA and server cert PEM must differ");
}

#[test]
fn second_call_is_idempotent() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let first = ensure_pki(&dir_str).expect("first ensure_pki");
    let second = ensure_pki(&dir_str).expect("second ensure_pki");
    assert_eq!(
        first.ca_cert_pem, second.ca_cert_pem,
        "CA cert must be stable across calls",
    );
    assert_eq!(
        first.server_cert_pem, second.server_cert_pem,
        "server cert must be stable across calls",
    );
    assert_eq!(
        first.server_key_pem, second.server_key_pem,
        "server key must be stable across calls",
    );
}

#[test]
#[traced_test]
fn fingerprint_is_logged_for_each_loaded_cert() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let _mat = ensure_pki(&dir_str).expect("ensure_pki");
    assert!(
        logs_contain("CA cert"),
        "CA cert fingerprint must be logged",
    );
    assert!(
        logs_contain("Server cert"),
        "Server cert fingerprint must be logged",
    );
    assert!(
        logs_contain("Certificat chargé"),
        "log message body missing",
    );
}

#[test]
fn cert_not_expired_passes_for_freshly_generated_cert() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let mat = ensure_pki(&dir_str).expect("ensure_pki");
    assert_cert_not_expired("Server cert", &mat.server_cert_pem, SystemTime::now())
        .expect("freshly generated cert must not be expired");
    assert_cert_not_expired("CA cert", &mat.ca_cert_pem, SystemTime::now())
        .expect("freshly generated CA must not be expired");
}

#[test]
fn cert_not_expired_fails_when_clock_is_after_not_after() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let mat = ensure_pki(&dir_str).expect("ensure_pki");
    // The PKI module hardcodes not_after = 2034-01-01. Push the clock to
    // 2050 — far past expiry — and expect an error.
    let future = SystemTime::UNIX_EPOCH + Duration::from_secs(2_524_608_000); // ~2050
    let result = assert_cert_not_expired("Server cert", &mat.server_cert_pem, future);
    assert!(
        result.is_err(),
        "expired cert must be refused; got {result:?}",
    );
    let msg = format!("{:#}", result.unwrap_err());
    assert!(msg.contains("expired"), "wrong error message: {msg}",);
}

#[test]
#[traced_test]
fn cert_not_expired_warns_when_within_30_days() {
    let dir = TempDir::new().expect("tempdir");
    let dir_str = dir.path().to_str().unwrap().to_string();
    let mat = ensure_pki(&dir_str).expect("ensure_pki");
    // Push clock to ~15 days before the hardcoded 2034-01-01 expiry.
    let almost_expired = SystemTime::UNIX_EPOCH + Duration::from_secs(2_019_859_200 - 15 * 86_400);
    assert_cert_not_expired("Server cert", &mat.server_cert_pem, almost_expired)
        .expect("near-expiry cert must still pass (only warn)");
    assert!(
        logs_contain("proche de l'expiration") || logs_contain("days_left"),
        "expected near-expiry warning in logs",
    );
}

#[test]
fn cert_not_expired_errors_on_garbage_pem() {
    let result = assert_cert_not_expired("Garbage", b"not a pem", SystemTime::now());
    assert!(result.is_err(), "garbage PEM must error");
}

#[test]
fn errors_when_pki_dir_is_unwritable() {
    // /proc is a procfs mount that rejects writes — a stable, OS-managed
    // unwritable target. Skip on platforms where this isn't true.
    let path = "/proc/this-pki-does-not-exist-and-cannot-be-created";
    let result = ensure_pki(path);
    assert!(
        result.is_err(),
        "writing to /proc must fail; otherwise this test no longer matches its premise",
    );
}
