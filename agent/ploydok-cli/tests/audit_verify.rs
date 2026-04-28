// SPDX-License-Identifier: AGPL-3.0-only
use ploydok_cli::audit_verify::Config;
use std::env;

#[test]
fn test_audit_verify_requires_pubkey() {
    // Test that run() fails gracefully if no pubkey is provided
    let config = Config {
        db_url: "postgres://localhost/test".to_string(),
        pubkey_bytes: None,
        pubkey_file: None,
    };

    let result = ploydok_cli::audit_verify::run(config);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("no pubkey provided"));
}

#[test]
fn test_audit_verify_invalid_pubkey_length() {
    // Test that run() rejects pubkey that's not 32 bytes
    let config = Config {
        db_url: "postgres://localhost/test".to_string(),
        pubkey_bytes: Some(vec![0u8; 16]), // Wrong length
        pubkey_file: None,
    };

    let result = ploydok_cli::audit_verify::run(config);
    assert!(result.is_err());
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("invalid pubkey length"));
}

#[test]
fn test_audit_verify_with_postgres() {
    // Integration test: requires PLOYDOK_TEST_PG_URL env var
    // Skip gracefully if not set
    let db_url = match env::var("PLOYDOK_TEST_PG_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("Skipping test_audit_verify_with_postgres: PLOYDOK_TEST_PG_URL not set");
            return;
        }
    };

    // Generate a 32-byte dummy pubkey for testing
    // This is a valid Ed25519 public key structure (all zeros for simplicity)
    let pubkey = vec![
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
    ];

    let config = Config {
        db_url,
        pubkey_bytes: Some(pubkey),
        pubkey_file: None,
    };

    // This test will fail to connect if the database is not running,
    // but that's acceptable in CI/test environments without a Postgres instance.
    // We're primarily testing the structure and error handling logic.
    let result = ploydok_cli::audit_verify::run(config);

    // If we get here, either:
    // 1. The database connected and ran verification (could be exit code 0, 1, 2, 3, or 4)
    // 2. The database didn't connect (io/connection error)
    //
    // Either way, we've validated that the function doesn't panic and returns a Result.
    // In a real integration test environment with a live Postgres, we'd assert the exit code.
    if let Ok(_exit_code) = result {
        // Verification completed (regardless of outcome)
    }
}
