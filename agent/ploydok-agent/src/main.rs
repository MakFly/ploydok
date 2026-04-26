// SPDX-License-Identifier: AGPL-3.0-only
//
// ploydok-agent — entry point.
//
// Bootstraps tracing (JSON), connects to Docker, binds a Unix socket, and
// serves the gRPC AgentService with mTLS.
//
// Configuration (env vars):
//   PLOYDOK_AGENT_SOCKET      Path to the Unix socket
//                             (default: /run/ploydok/agent.sock)
//   PLOYDOK_AGENT_PKI_DIR     PKI directory for mTLS certs
//                             (default: /var/lib/ploydok/pki)
//   PLOYDOK_AGENT_INSECURE    Set to "1" to disable mTLS (dev/CI only — DANGER)
//   PLOYDOK_VALIDATOR_CONFIG  Path to a TOML/JSON validator config file
//   DOCKER_HOST               Override Docker daemon endpoint

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use tokio::net::UnixListener;
use tokio_stream::wrappers::UnixListenerStream;
use tonic::transport::Server;
use tracing::{info, warn};

use ploydok_proto::agent::agent_server::AgentServer;

mod audit;
mod boot_guard;
mod host_stats;
mod pki;
mod service;
mod socket_config;
mod validator;

use boot_guard::assert_insecure_safe_from_process_env;
use service::AgentService;
use socket_config::{ALLOWED_SOCKET_DIRS, validate_socket_path};
use validator::StrictValidator;

const DEFAULT_SOCKET: &str = "/run/ploydok/agent.sock";
const DEFAULT_PKI_DIR: &str = "/var/lib/ploydok/pki";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Tracing (JSON) ───────────────────────────────────────────────────────
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // ── Socket path ──────────────────────────────────────────────────────────
    let socket_path =
        std::env::var("PLOYDOK_AGENT_SOCKET").unwrap_or_else(|_| DEFAULT_SOCKET.to_string());
    let socket_path = Path::new(&socket_path);

    validate_socket_path(socket_path, ALLOWED_SOCKET_DIRS)?;
    let parent = socket_path
        .parent()
        .expect("validate_socket_path guarantees a parent");

    // Create parent directory if it doesn't exist.
    if !parent.exists() {
        std::fs::create_dir_all(parent)?;
        info!(path = %parent.display(), "created socket parent directory");
    }

    // Remove stale socket file if present (from a previous run).
    if socket_path.exists() {
        std::fs::remove_file(socket_path)?;
        info!(path = %socket_path.display(), "removed stale socket file");
    }

    // ── Docker client ────────────────────────────────────────────────────────
    let docker = bollard::Docker::connect_with_socket_defaults()?;
    docker.ping().await?;
    info!("connected to Docker daemon");

    // ── Validator ────────────────────────────────────────────────────────────
    let validator = StrictValidator::from_env()?;
    info!(
        config = ?validator.config(),
        "StrictValidator actif"
    );
    let validator = Arc::new(validator);

    // ── gRPC service ─────────────────────────────────────────────────────────
    let agent_service = AgentService::new(docker, validator);
    let svc = AgentServer::new(agent_service);

    // ── Unix socket listener ─────────────────────────────────────────────────
    // Allow non-root host clients (e.g. the API running as the dev user) to
    // connect when the agent runs as root inside its container. We narrow the
    // umask so the socket is born with mode 0o666 — eliminates the race
    // window where the socket exists with the default mode between bind() and
    // a post-bind chmod. mTLS gates real auth in production
    // (PLOYDOK_AGENT_INSECURE=0); these FS perms only matter in dev/insecure.
    //
    // SAFETY: umask() is process-global and not thread-safe. We call it during
    // single-threaded boot before any file-creating task is spawned.
    let prev_umask = unsafe { libc::umask(0o111) };
    let listener = UnixListener::bind(socket_path)?;
    // Restore the previous umask immediately so subsequent file creations
    // (PKI bootstrap, cargo target writes, etc.) are not affected.
    unsafe {
        libc::umask(prev_umask);
    }
    // Defense-in-depth: explicitly enforce mode 0o666 in case the umask was
    // ignored by an exotic FS. We log on failure rather than aborting — the
    // listener is bound, terminating now would leave a stale socket file.
    if let Err(err) =
        std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o666))
    {
        warn!(?err, socket = %socket_path.display(),
            "failed to chmod 0o666 on socket; non-root host clients may fail to connect");
    }
    let stream = UnixListenerStream::new(listener);
    info!(socket = %socket_path.display(), "ploydok-agent listening");

    // ── mTLS ou mode insecure ─────────────────────────────────────────────────
    let insecure = std::env::var("PLOYDOK_AGENT_INSECURE")
        .map(|v| v == "1")
        .unwrap_or(false);

    // Refuse to boot insecure if the env advertises production. The check is
    // not a substitute for proper PKI hygiene but stops at least the obvious
    // accident of pushing `PLOYDOK_AGENT_INSECURE=1` to a prod compose file.
    assert_insecure_safe_from_process_env(insecure)?;

    if insecure {
        warn!("⚠️  mTLS DÉSACTIVÉ (PLOYDOK_AGENT_INSECURE=1) — NE JAMAIS UTILISER EN PRODUCTION");
        Server::builder()
            .add_service(svc)
            .serve_with_incoming(stream)
            .await?;
    } else {
        // ── PKI bootstrap ─────────────────────────────────────────────────────
        let pki_dir =
            std::env::var("PLOYDOK_AGENT_PKI_DIR").unwrap_or_else(|_| DEFAULT_PKI_DIR.to_string());

        let pki = pki::ensure_pki(&pki_dir)?;

        let tls = tonic::transport::ServerTlsConfig::new()
            .identity(tonic::transport::Identity::from_pem(
                &pki.server_cert_pem,
                &pki.server_key_pem,
            ))
            .client_ca_root(tonic::transport::Certificate::from_pem(&pki.ca_cert_pem));

        Server::builder()
            .tls_config(tls)?
            .add_service(svc)
            .serve_with_incoming(stream)
            .await?;
    }

    Ok(())
}
