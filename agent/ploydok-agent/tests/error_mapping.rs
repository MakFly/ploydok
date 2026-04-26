// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::service::bollard_err — the bollard::Error →
// tonic::Status mapping. Pins the contract so RPC handlers stay consistent.

use bollard::errors::Error as BollardError;
use tonic::Code;

use ploydok_agent::service::bollard_err;

#[test]
fn maps_docker_404_to_not_found() {
    let err = BollardError::DockerResponseServerError {
        status_code: 404,
        message: "no such container".to_string(),
    };
    let status = bollard_err("remove_container", err);
    assert_eq!(status.code(), Code::NotFound);
    assert!(
        status.message().contains("remove_container"),
        "context must be in message: {}",
        status.message()
    );
    assert!(
        status.message().contains("no such container"),
        "docker message must be in tonic message: {}",
        status.message()
    );
}

#[test]
fn maps_docker_409_to_already_exists() {
    let err = BollardError::DockerResponseServerError {
        status_code: 409,
        message: "network with name already exists".to_string(),
    };
    let status = bollard_err("create_network", err);
    assert_eq!(status.code(), Code::AlreadyExists);
}

#[test]
fn maps_docker_500_to_internal() {
    let err = BollardError::DockerResponseServerError {
        status_code: 500,
        message: "daemon panicked".to_string(),
    };
    let status = bollard_err("create_container", err);
    assert_eq!(status.code(), Code::Internal);
}

#[test]
fn maps_docker_400_to_internal_fallback() {
    // 400 is not specially mapped — current behavior is fallback to Internal.
    // Pinned so a future change is intentional.
    let err = BollardError::DockerResponseServerError {
        status_code: 400,
        message: "bad request".to_string(),
    };
    let status = bollard_err("create_container", err);
    assert_eq!(status.code(), Code::Internal);
}

#[test]
fn maps_io_error_to_internal() {
    let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "docker.sock down");
    let err = BollardError::IOError { err: io };
    let status = bollard_err("ping", err);
    // Current implementation maps everything non-Docker-HTTP to Internal.
    assert_eq!(status.code(), Code::Internal);
    assert!(
        status.message().contains("ping"),
        "context must propagate, got: {}",
        status.message()
    );
}

#[test]
fn maps_request_timeout_to_internal() {
    let err = BollardError::RequestTimeoutError;
    let status = bollard_err("list_containers", err);
    assert_eq!(status.code(), Code::Internal);
}

#[test]
fn message_does_not_leak_secret_substrings() {
    // Sanity: the bollard error message becomes the Status.message verbatim,
    // so any caller passing context strings should not contain a secret. We
    // pin that bollard_err itself does not invent extra fields like host
    // paths or environment variables — it just passes through what it received.
    let err = BollardError::DockerResponseServerError {
        status_code: 500,
        message: "boom".to_string(),
    };
    let status = bollard_err("rpc_x", err);
    let msg = status.message();
    // No accidental bot-host paths in the message.
    assert!(
        !msg.contains("/etc/") && !msg.contains("/root/") && !msg.contains("/home/"),
        "status message must not embed host paths: {msg}"
    );
}
