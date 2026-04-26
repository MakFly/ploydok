// SPDX-License-Identifier: AGPL-3.0-only
//
// Unit tests for ploydok_agent::service::validate_first_exec_frame —
// guards the entry point of the ContainerExec bidi stream against
// out-of-order frames before any Docker call is made.

use ploydok_proto::agent::{exec_frame, ExecFrame, ExecResize, ExecStart};
use tonic::Code;

use ploydok_agent::service::validate_first_exec_frame;

fn frame_with(payload: exec_frame::Payload) -> ExecFrame {
    ExecFrame {
        payload: Some(payload),
    }
}

fn valid_start() -> ExecStart {
    ExecStart {
        container_id: "ploydok-app-x".to_string(),
        cmd: vec!["/bin/sh".to_string()],
        tty: true,
        cols: 80,
        rows: 24,
        user: String::new(),
    }
}

#[test]
fn accepts_first_frame_as_exec_start() {
    let frame = frame_with(exec_frame::Payload::Start(valid_start()));
    let start = validate_first_exec_frame(frame).expect("ExecStart first must be Ok");
    assert_eq!(start.container_id, "ploydok-app-x");
    assert_eq!(start.cmd, vec!["/bin/sh"]);
    assert!(start.tty);
}

#[test]
fn rejects_stdin_as_first_frame() {
    let frame = frame_with(exec_frame::Payload::Stdin(b"hello".to_vec()));
    let err = validate_first_exec_frame(frame).expect_err("stdin first must be rejected");
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("first frame must be ExecStart"),
        "wrong message: {}",
        err.message()
    );
}

#[test]
fn rejects_resize_as_first_frame() {
    let frame = frame_with(exec_frame::Payload::Resize(ExecResize {
        cols: 80,
        rows: 24,
    }));
    let err = validate_first_exec_frame(frame).expect_err("resize first must be rejected");
    assert_eq!(err.code(), Code::InvalidArgument);
}

#[test]
fn rejects_empty_payload_frame() {
    let frame = ExecFrame { payload: None };
    let err = validate_first_exec_frame(frame).expect_err("empty payload must be rejected");
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(err.message().contains("first frame must be ExecStart"));
}

#[test]
fn rejects_stdout_as_first_frame() {
    // stdout is server-side, but we test that the validator does not silently
    // accept a payload that semantically should never come from the client.
    let frame = frame_with(exec_frame::Payload::Stdout(b"oops".to_vec()));
    let err = validate_first_exec_frame(frame).expect_err("stdout from client must be rejected");
    assert_eq!(err.code(), Code::InvalidArgument);
}
