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

use std::path::Path;
use std::sync::Arc;

use tokio::net::UnixListener;
use tokio_stream::wrappers::UnixListenerStream;
use tonic::transport::Server;
use tracing::{info, warn};

use ploydok_proto::agent::agent_server::AgentServer;

mod audit;
mod pki;
mod service;
mod validator;

use service::AgentService;
use validator::{StrictValidator, ValidatorConfig};

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

    // Create parent directory if it doesn't exist.
    if let Some(parent) = socket_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)?;
            info!(path = %parent.display(), "created socket parent directory");
        }
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
    let validator = Arc::new(StrictValidator::from_env()?);
    info!(
        config = ?ValidatorConfig::default(),
        "StrictValidator actif"
    );

    // ── gRPC service ─────────────────────────────────────────────────────────
    let agent_service = AgentService::new(docker, validator);
    let svc = AgentServer::new(agent_service);

    // ── Unix socket listener ─────────────────────────────────────────────────
    let listener = UnixListener::bind(socket_path)?;
    let stream = UnixListenerStream::new(listener);
    info!(socket = %socket_path.display(), "ploydok-agent listening");

    // ── mTLS ou mode insecure ─────────────────────────────────────────────────
    let insecure = std::env::var("PLOYDOK_AGENT_INSECURE")
        .map(|v| v == "1")
        .unwrap_or(false);

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
