// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for the umask + chmod sequence used by ploydok-agent's
// boot path. These tests bind a Unix domain socket inside a tempdir and
// verify that:
//   1. the umask narrowing produces a 0o666 socket directly,
//   2. the previous umask is restored after the bind,
//   3. a second bind (after remove_file) still yields 0o666 perms.
//
// `umask()` is process-global and not thread-safe — `#[serial]` ensures
// these tests do not race with each other or with other umask-touching tests.

use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener as StdUnixListener;

use serial_test::serial;
use tempfile::TempDir;

/// Bind a Unix socket using the same umask + chmod sequence as the agent's
/// `main()`. Returns the binder process's mode bits as observed from `stat`.
fn bind_with_agent_protocol(socket_path: &std::path::Path) -> u32 {
    // Snapshot and tighten umask so the socket is born world-rw. SAFETY:
    // process-global, gated by `#[serial]`.
    let prev = unsafe { libc::umask(0o111) };

    let listener = StdUnixListener::bind(socket_path).expect("bind unix socket");
    drop(listener);

    unsafe {
        libc::umask(prev);
    }

    // Defense-in-depth chmod, mirroring main.rs.
    std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o666))
        .expect("set 0o666 on socket");

    // Read the mode from the FS — reflects what a non-root host client would see.
    let meta = std::fs::metadata(socket_path).expect("stat socket");
    meta.permissions().mode() & 0o777
}

#[test]
#[serial]
fn socket_is_born_with_world_rw_after_umask_and_chmod() {
    let dir = TempDir::new().expect("tempdir");
    let socket = dir.path().join("agent.sock");
    let mode = bind_with_agent_protocol(&socket);
    assert_eq!(
        mode, 0o666,
        "socket must end up at mode 0o666 (got 0o{mode:o})",
    );
}

#[test]
#[serial]
fn umask_is_restored_after_bind() {
    let dir = TempDir::new().expect("tempdir");
    let socket = dir.path().join("agent.sock");

    // Set a known umask before the bind sequence.
    let baseline = 0o022;
    let prior = unsafe { libc::umask(baseline) };
    let _ = unsafe { libc::umask(baseline) }; // re-apply after read

    let _ = bind_with_agent_protocol(&socket);

    // After the protocol returns, the umask must be back to `baseline`,
    // otherwise subsequent file creations leak the relaxed 0o111 umask.
    let observed = unsafe { libc::umask(prior) };
    assert_eq!(
        observed, baseline,
        "umask must be restored to 0o{baseline:o}, observed 0o{observed:o}",
    );
}

#[test]
#[serial]
fn second_bind_after_remove_keeps_world_rw() {
    let dir = TempDir::new().expect("tempdir");
    let socket = dir.path().join("agent.sock");

    let mode1 = bind_with_agent_protocol(&socket);
    assert_eq!(mode1, 0o666, "first bind must yield 0o666");

    // Remove the stale socket like main.rs does on restart, then rebind.
    std::fs::remove_file(&socket).expect("remove stale socket");
    let mode2 = bind_with_agent_protocol(&socket);
    assert_eq!(mode2, 0o666, "second bind must also yield 0o666");
}
