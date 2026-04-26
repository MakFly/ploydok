// SPDX-License-Identifier: AGPL-3.0-only
//
// AgentService — tonic gRPC service backed by bollard.
//
// SECURITY MODEL
// --------------
// The agent enforces three things at this layer:
//   1. **Shape validation** via `validator::Validator` (image registries,
//      volume prefixes, container/network name patterns, exec cmd[0] whitelist).
//   2. **mTLS authentication** of the calling process when
//      `PLOYDOK_AGENT_INSECURE != "1"` (see `main.rs` and `pki.rs`).
//   3. **Audit logging** of each RPC entry/exit with the mTLS CN
//      (`audit_with_client(...)` from request-driven sites).
//
// What the agent does **NOT** do — and why this matters at every call site:
//   - **No ownership check.** The agent does not verify that the calling user
//     is authorised to act on the target container/network/image. It trusts
//     that the API has performed that check before forwarding the RPC.
//     Callers exposing the agent socket to less-trusted clients must layer
//     their own authorisation in front.
//   - **No certificate revocation.** A compromised client cert remains valid
//     until the PKI is rotated (`pki::ensure_pki` regenerates everything when
//     the dir is wiped — see runbook).
//   - **`exec cmd[1..]` is not sanitised.** The validator only whitelists
//     `cmd[0]` (shell); arbitrary shell scripts can be passed via `cmd[1..]`.
//     The API must not let untrusted input flow into exec arguments.
//
// Extension points for task 2.3:
//   - Replace `PermissiveValidator` with `StrictValidator` when constructing `AgentService`.
//   - `audit()` calls are already in place; redirect them to DB in 2.4.
//   - All bollard errors are wrapped via `bollard_err` → single place to enrich errors.

use std::collections::HashMap;
use std::sync::Arc;

use bollard::container::{
    Config, CreateContainerOptions, LogsOptions, RemoveContainerOptions, StatsOptions,
    StopContainerOptions,
};
use bollard::exec::{CreateExecOptions, ResizeExecOptions, StartExecOptions, StartExecResults};
use bollard::image::{BuildImageOptions, CreateImageOptions};
use bollard::models::EndpointSettings;
use bollard::models::{
    HealthConfig, HostConfig, PortBinding, RestartPolicy, RestartPolicyNameEnum,
};
use bollard::network::{ConnectNetworkOptions, CreateNetworkOptions, DisconnectNetworkOptions};
use futures::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio::time::{Duration, Instant};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};

use ploydok_proto::agent::{
    agent_server::Agent, exec_frame, restore_chunk, BuildProgress, ContainerCreateRequest,
    ContainerCreateResponse, ContainerLogsRequest, ContainerRemoveRequest, ContainerRemoveResponse,
    ContainerStartRequest, ContainerStartResponse, ContainerStatsRequest, ContainerStopRequest,
    ContainerStopResponse, DumpChunk, DumpRequest, ExecFrame, FileEntry, HostStatsRequest,
    HostStatsResponse, ImageBuildRequest, ImagePullRequest, InspectContainerHealthRequest,
    InspectContainerHealthResponse, ListContainerFilesRequest, ListContainerFilesResponse,
    ListContainersRequest, ListContainersResponse, LogLine, NetworkConnectRequest,
    NetworkConnectResponse, NetworkCreateRequest, NetworkCreateResponse, NetworkDisconnectRequest,
    NetworkDisconnectResponse, NetworkRemoveRequest, NetworkRemoveResponse, PingContainerRequest,
    PingContainerResponse, PullProgress, ReadContainerFileRequest, ReadContainerFileResponse,
    RestoreChunk, RestoreResult, StatsFrame,
};

use crate::audit::{audit, audit_with_client, client_identity_from_request};
use crate::validator::Validator;

// Include monitor.rs as a submodule. This is the single canonical declaration
// of the monitor module; lib.rs re-exports it via `pub use service::monitor`.
// The binary (main.rs) does not need a separate `mod monitor;` declaration.
#[path = "monitor.rs"]
pub mod monitor;
use monitor::Monitor;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Map a bollard error to a tonic `Status` and log it.
///
/// Docker returns HTTP status codes via `DockerResponseServerError` — map them
/// to the appropriate gRPC status so clients can react idempotently:
///   - 404 → `NotFound` (remove a container that's already gone, etc.)
///   - 409 → `AlreadyExists` (create_network when it already exists, etc.)
///
/// Everything else falls back to `Internal`.
/// Validate that the first frame received on the `ContainerExec` bidi stream
/// carries an `ExecStart` payload — anything else is a protocol violation
/// from the client. Extracted so the state-machine entry can be unit-tested
/// without a live Docker connection.
#[allow(clippy::result_large_err)] // Status is the canonical error type at this boundary; boxing would force unboxing at every call site.
pub fn validate_first_exec_frame(
    frame: ExecFrame,
) -> Result<ploydok_proto::agent::ExecStart, Status> {
    match frame.payload {
        Some(exec_frame::Payload::Start(s)) => Ok(s),
        _ => Err(Status::invalid_argument("first frame must be ExecStart")),
    }
}

pub fn bollard_err(context: &str, err: bollard::errors::Error) -> Status {
    if let bollard::errors::Error::DockerResponseServerError {
        status_code,
        ref message,
    } = err
    {
        let detail = format!("{context}: {message}");
        match status_code {
            404 => {
                tracing::debug!(
                    context = context,
                    status = status_code,
                    "docker 404 → NotFound"
                );
                return Status::not_found(detail);
            }
            409 => {
                tracing::debug!(
                    context = context,
                    status = status_code,
                    "docker 409 → AlreadyExists"
                );
                return Status::already_exists(detail);
            }
            _ => {}
        }
    }
    tracing::error!(context = context, error = %err, "bollard error");
    Status::internal(format!("{context}: {err}"))
}

/// Convert a proto restart policy string to bollard's enum.
fn restart_policy_name(s: &str) -> RestartPolicyNameEnum {
    match s {
        "always" => RestartPolicyNameEnum::ALWAYS,
        "unless-stopped" => RestartPolicyNameEnum::UNLESS_STOPPED,
        "on-failure" => RestartPolicyNameEnum::ON_FAILURE,
        "no" => RestartPolicyNameEnum::NO,
        _ => RestartPolicyNameEnum::EMPTY,
    }
}

fn healthcheck_nanos(seconds: i64) -> Option<i64> {
    if seconds <= 0 {
        None
    } else {
        Some(seconds.saturating_mul(1_000_000_000))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentService
// ─────────────────────────────────────────────────────────────────────────────

pub struct AgentService {
    docker: bollard::Docker,
    /// Pluggable validator — swap for StrictValidator in task 2.3.
    validator: Arc<dyn Validator>,
    /// Monitoring — background cache of container snapshots + ad-hoc ping.
    monitor: Arc<Monitor>,
}

impl AgentService {
    /// Construct the service. Monitor is created internally from a cloned Docker handle.
    /// The background poll task (2-second interval) is started automatically.
    pub fn new(docker: bollard::Docker, validator: Arc<dyn Validator>) -> Self {
        let monitor = Monitor::new(docker.clone());
        // Spawn the poll loop immediately — cache will be warm within 2s.
        Arc::clone(&monitor).spawn_poll_task();
        Self {
            docker,
            validator,
            monitor,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// tonic Agent trait implementation
// ─────────────────────────────────────────────────────────────────────────────

#[tonic::async_trait]
impl Agent for AgentService {
    // ── ContainerCreate ──────────────────────────────────────────────────────

    async fn container_create(
        &self,
        request: Request<ContainerCreateRequest>,
    ) -> Result<Response<ContainerCreateResponse>, Status> {
        // SECURITY: API must enforce ownership before calling agent. The
        // agent only checks the request shape and the mTLS CN (logged below);
        // it does not verify that the caller owns the container being created.
        let client = client_identity_from_request(&request);
        let req = request.into_inner();
        audit_with_client("container_create", &req.name, Ok(()), &client);

        self.validator
            .validate_container_create(&req)
            .inspect_err(|s| {
                audit_with_client("container_create", &req.name, Err(s.message()), &client);
            })
            .map_err(|s| *s)?;

        // Build environment variables list.
        let env: Vec<String> = req.env.iter().map(|(k, v)| format!("{k}={v}")).collect();

        // Build bind-mount strings: "host_path:container_path[:ro]"
        let binds: Vec<String> = req
            .volumes
            .iter()
            .map(|v| {
                if v.read_only {
                    format!("{}:{}:ro", v.host_path, v.container_path)
                } else {
                    format!("{}:{}", v.host_path, v.container_path)
                }
            })
            .collect();

        // Build port bindings: {"container_port/proto": [PortBinding]}
        let port_bindings: HashMap<String, Option<Vec<PortBinding>>> = req
            .ports
            .iter()
            .map(|p| {
                let proto = if p.proto.is_empty() { "tcp" } else { &p.proto };
                let key = format!("{}/{}", p.container_port, proto);
                let binding = PortBinding {
                    host_ip: Some("0.0.0.0".into()),
                    host_port: Some(p.host_port.to_string()),
                };
                (key, Some(vec![binding]))
            })
            .collect();

        // Resource limits
        let host_config = HostConfig {
            binds: if binds.is_empty() { None } else { Some(binds) },
            port_bindings: if port_bindings.is_empty() {
                None
            } else {
                Some(port_bindings)
            },
            restart_policy: if req.restart_policy.is_empty() {
                None
            } else {
                Some(RestartPolicy {
                    name: Some(restart_policy_name(&req.restart_policy)),
                    maximum_retry_count: None,
                })
            },
            memory: req.resource_limits.as_ref().and_then(|r| {
                if r.memory_bytes > 0 {
                    Some(r.memory_bytes)
                } else {
                    None
                }
            }),
            // bollard uses nano_cpus (1e9 per CPU core)
            nano_cpus: req.resource_limits.as_ref().and_then(|r| {
                if r.cpu > 0.0 {
                    Some((r.cpu * 1_000_000_000.0) as i64)
                } else {
                    None
                }
            }),
            pids_limit: req.resource_limits.as_ref().and_then(|r| {
                if r.pids_limit > 0 {
                    Some(r.pids_limit)
                } else {
                    None
                }
            }),
            ..Default::default()
        };

        let healthcheck = req.healthcheck.as_ref().map(|hc| HealthConfig {
            test: if hc.test.is_empty() {
                None
            } else {
                Some(hc.test.clone())
            },
            interval: healthcheck_nanos(hc.interval_seconds),
            timeout: healthcheck_nanos(hc.timeout_seconds),
            retries: if hc.retries == 0 {
                None
            } else {
                Some(hc.retries as i64)
            },
            start_period: healthcheck_nanos(hc.start_period_seconds),
            start_interval: None,
        });

        let config = Config {
            image: Some(req.image.clone()),
            env: if env.is_empty() { None } else { Some(env) },
            labels: if req.labels.is_empty() {
                None
            } else {
                Some(req.labels.clone())
            },
            cmd: if req.command.is_empty() {
                None
            } else {
                Some(req.command.clone())
            },
            user: if req.user.is_empty() {
                None
            } else {
                Some(req.user.clone())
            },
            healthcheck,
            host_config: Some(host_config),
            // Attach only the first requested network at create time. Docker's
            // create_container API silently drops extra EndpointsConfig entries
            // across versions; subsequent networks are wired via connect_network
            // below. Empty list → Docker default bridge.
            networking_config: {
                use bollard::container::NetworkingConfig;
                use bollard::models::EndpointSettings;
                let first_network: Option<&str> = if !req.networks.is_empty() {
                    Some(req.networks[0].as_str())
                } else if !req.network.is_empty() {
                    Some(req.network.as_str())
                } else {
                    None
                };
                first_network.map(|name| {
                    let mut endpoints = HashMap::new();
                    endpoints.insert(name.to_string(), EndpointSettings::default());
                    NetworkingConfig {
                        endpoints_config: endpoints,
                    }
                })
            },
            ..Default::default()
        };

        let options = CreateContainerOptions {
            name: req.name.clone(),
            platform: None::<String>,
        };

        let result = self
            .docker
            .create_container(Some(options), config)
            .await
            .map_err(|e| bollard_err("create_container", e))?;

        // Attach remaining networks explicitly. Required for cross-version
        // Docker compatibility: create_container only honors a single entry
        // in NetworkingConfig, so Caddy-reachable networks (e.g. ingress)
        // never attached when passed alongside a project network.
        if req.networks.len() > 1 {
            use bollard::models::EndpointSettings;
            use bollard::network::ConnectNetworkOptions;
            for name in req.networks.iter().skip(1) {
                let opts = ConnectNetworkOptions {
                    container: result.id.clone(),
                    endpoint_config: EndpointSettings::default(),
                };
                self.docker
                    .connect_network(name, opts)
                    .await
                    .map_err(|e| bollard_err("connect_network", e))?;
            }
        }

        audit_with_client("container_create", &req.name, Ok(()), &client);
        Ok(Response::new(ContainerCreateResponse {
            container_id: result.id,
        }))
    }

    // ── ContainerStart ───────────────────────────────────────────────────────

    async fn container_start(
        &self,
        request: Request<ContainerStartRequest>,
    ) -> Result<Response<ContainerStartResponse>, Status> {
        let req = request.into_inner();
        audit("container_start", &req.container_id, Ok(()));
        self.validator
            .validate_container_start(&req)
            .map_err(|e| *e)?;

        self.docker
            .start_container::<String>(&req.container_id, None)
            .await
            .map_err(|e| bollard_err("start_container", e))?;

        audit("container_start", &req.container_id, Ok(()));
        Ok(Response::new(ContainerStartResponse {}))
    }

    // ── ContainerStop ────────────────────────────────────────────────────────

    async fn container_stop(
        &self,
        request: Request<ContainerStopRequest>,
    ) -> Result<Response<ContainerStopResponse>, Status> {
        let req = request.into_inner();
        audit("container_stop", &req.container_id, Ok(()));
        self.validator
            .validate_container_stop(&req)
            .map_err(|e| *e)?;

        let options = if req.timeout_seconds > 0 {
            Some(StopContainerOptions {
                t: req.timeout_seconds as i64,
            })
        } else {
            None
        };

        self.docker
            .stop_container(&req.container_id, options)
            .await
            .map_err(|e| bollard_err("stop_container", e))?;

        audit("container_stop", &req.container_id, Ok(()));
        Ok(Response::new(ContainerStopResponse {}))
    }

    // ── ContainerRemove ──────────────────────────────────────────────────────

    async fn container_remove(
        &self,
        request: Request<ContainerRemoveRequest>,
    ) -> Result<Response<ContainerRemoveResponse>, Status> {
        let req = request.into_inner();
        audit("container_remove", &req.container_id, Ok(()));
        self.validator
            .validate_container_remove(&req)
            .map_err(|e| *e)?;

        let options = RemoveContainerOptions {
            force: req.force,
            v: req.remove_volumes,
            link: false,
        };

        self.docker
            .remove_container(&req.container_id, Some(options))
            .await
            .map_err(|e| bollard_err("remove_container", e))?;

        audit("container_remove", &req.container_id, Ok(()));
        Ok(Response::new(ContainerRemoveResponse {}))
    }

    // ── ContainerLogs (stream) ───────────────────────────────────────────────

    type ContainerLogsStream = ReceiverStream<Result<LogLine, Status>>;

    async fn container_logs(
        &self,
        request: Request<ContainerLogsRequest>,
    ) -> Result<Response<Self::ContainerLogsStream>, Status> {
        let req = request.into_inner();
        audit("container_logs", &req.container_id, Ok(()));

        let tail_str = if req.tail > 0 {
            req.tail.to_string()
        } else {
            "all".to_string()
        };

        let options = LogsOptions {
            follow: req.follow,
            stdout: true,
            stderr: true,
            since: req.since_unix,
            until: 0,
            timestamps: true,
            tail: tail_str,
        };

        // Clone docker handle — bollard::Docker is cheaply cloneable (Arc inside).
        let docker = self.docker.clone();
        let container_id = req.container_id.clone();

        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(async move {
            let mut stream = docker.logs(&container_id, Some(options));
            while let Some(item) = stream.next().await {
                match item {
                    Ok(log_output) => {
                        let (stream_name, raw) = match &log_output {
                            bollard::container::LogOutput::StdOut { message } => {
                                ("stdout", message.clone())
                            }
                            bollard::container::LogOutput::StdErr { message } => {
                                ("stderr", message.clone())
                            }
                            bollard::container::LogOutput::StdIn { message } => {
                                ("stdin", message.clone())
                            }
                            bollard::container::LogOutput::Console { message } => {
                                ("console", message.clone())
                            }
                        };
                        // Docker log line format with timestamps: "<rfc3339> <message>"
                        let raw_str = String::from_utf8_lossy(&raw);
                        let (timestamp, line) = if let Some(pos) = raw_str.find(' ') {
                            (&raw_str[..pos], raw_str[pos + 1..].trim_end_matches('\n'))
                        } else {
                            ("", raw_str.trim_end_matches('\n'))
                        };
                        let log_line = LogLine {
                            stream: stream_name.to_string(),
                            line: line.to_string(),
                            timestamp: timestamp.to_string(),
                        };
                        if tx.send(Ok(log_line)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::error!(
                            container_id = %container_id,
                            error = %e,
                            "container_logs stream error"
                        );
                        let _ = tx.send(Err(Status::internal(e.to_string()))).await;
                        break;
                    }
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── ContainerStats (stream) ──────────────────────────────────────────────

    type ContainerStatsStream = ReceiverStream<Result<StatsFrame, Status>>;

    async fn container_stats(
        &self,
        request: Request<ContainerStatsRequest>,
    ) -> Result<Response<Self::ContainerStatsStream>, Status> {
        let req = request.into_inner();
        audit("container_stats", &req.container_id, Ok(()));

        let options = StatsOptions {
            stream: req.stream,
            one_shot: !req.stream,
        };

        let docker = self.docker.clone();
        let container_id = req.container_id.clone();

        let (tx, rx) = mpsc::channel(16);
        tokio::spawn(async move {
            let mut stream = docker.stats(&container_id, Some(options));
            while let Some(item) = stream.next().await {
                match item {
                    Ok(stats) => {
                        let cpu_percent = compute_cpu_percent(&stats);

                        let memory_bytes = stats.memory_stats.usage.unwrap_or(0) as i64;
                        let memory_limit_bytes = stats.memory_stats.limit.unwrap_or(0) as i64;

                        // Network I/O: sum all interfaces.
                        let (net_rx, net_tx) = stats
                            .networks
                            .as_ref()
                            .map(|nets| {
                                nets.values().fold((0i64, 0i64), |(rx, tx), iface| {
                                    (rx + iface.rx_bytes as i64, tx + iface.tx_bytes as i64)
                                })
                            })
                            .unwrap_or((0, 0));

                        let frame = StatsFrame {
                            container_id: container_id.clone(),
                            timestamp_ns: 0,
                            cpu_percent,
                            memory_bytes,
                            memory_limit_bytes,
                            net_rx_bytes: net_rx,
                            net_tx_bytes: net_tx,
                        };

                        if tx.send(Ok(frame)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::error!(
                            container_id = %container_id,
                            error = %e,
                            "container_stats stream error"
                        );
                        let _ = tx.send(Err(Status::internal(e.to_string()))).await;
                        break;
                    }
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── ImagePull (stream) ───────────────────────────────────────────────────

    type ImagePullStream = ReceiverStream<Result<PullProgress, Status>>;

    async fn image_pull(
        &self,
        request: Request<ImagePullRequest>,
    ) -> Result<Response<Self::ImagePullStream>, Status> {
        let req = request.into_inner();
        audit("image_pull", &req.image, Ok(()));
        self.validator.validate_image_pull(&req).map_err(|e| *e)?;

        let options = CreateImageOptions {
            from_image: req.image.clone(),
            from_src: String::new(),
            repo: String::new(),
            tag: String::new(),
            platform: String::new(),
            changes: vec![],
        };

        // Registry auth is optional; only materialise it when either credential field is set.
        let credentials = req.registry_auth.as_ref().and_then(|a| {
            if a.username.is_empty() && a.password.is_empty() {
                None
            } else {
                Some(bollard::auth::DockerCredentials {
                    username: Some(a.username.clone()),
                    password: Some(a.password.clone()),
                    ..Default::default()
                })
            }
        });

        let docker = self.docker.clone();
        let image = req.image.clone();

        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(async move {
            let mut stream = docker.create_image(Some(options), None, credentials);
            while let Some(item) = stream.next().await {
                match item {
                    Ok(info) => {
                        let progress = PullProgress {
                            status: info.status.unwrap_or_default(),
                            layer_id: info.id.unwrap_or_default(),
                            current: info
                                .progress_detail
                                .as_ref()
                                .and_then(|d| d.current)
                                .unwrap_or(0),
                            total: info
                                .progress_detail
                                .as_ref()
                                .and_then(|d| d.total)
                                .unwrap_or(0),
                        };
                        if tx.send(Ok(progress)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::error!(image = %image, error = %e, "image_pull stream error");
                        let _ = tx.send(Err(Status::internal(e.to_string()))).await;
                        break;
                    }
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── ImageBuild (stream) ──────────────────────────────────────────────────
    //
    // v1 simplification: context files and the Dockerfile are assembled into a
    // tar archive in-memory, then sent as a single body to Docker.

    type ImageBuildStream = ReceiverStream<Result<BuildProgress, Status>>;

    async fn image_build(
        &self,
        request: Request<ImageBuildRequest>,
    ) -> Result<Response<Self::ImageBuildStream>, Status> {
        let req = request.into_inner();
        audit("image_build", &req.tag, Ok(()));
        self.validator.validate_image_build(&req).map_err(|e| *e)?;

        // Build an in-memory tar containing the Dockerfile + context files.
        let tar_bytes = build_tar_context(&req)
            .map_err(|e| Status::invalid_argument(format!("tar build error: {e}")))?;

        let build_args: HashMap<String, String> = req.build_args.clone();
        let options = BuildImageOptions {
            dockerfile: "Dockerfile".to_string(),
            t: req.tag.clone(),
            buildargs: build_args,
            rm: true,
            ..Default::default()
        };

        let docker = self.docker.clone();
        let tag = req.tag.clone();

        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(async move {
            let mut stream = docker.build_image(options, None, Some(bytes::Bytes::from(tar_bytes)));
            while let Some(item) = stream.next().await {
                match item {
                    Ok(info) => {
                        let progress = BuildProgress {
                            stream: info.stream.unwrap_or_default(),
                            error: info.error.unwrap_or_default(),
                        };
                        if tx.send(Ok(progress)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::error!(tag = %tag, error = %e, "image_build stream error");
                        let _ = tx.send(Err(Status::internal(e.to_string()))).await;
                        break;
                    }
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── NetworkCreate ────────────────────────────────────────────────────────

    async fn network_create(
        &self,
        request: Request<NetworkCreateRequest>,
    ) -> Result<Response<NetworkCreateResponse>, Status> {
        let req = request.into_inner();
        audit("network_create", &req.name, Ok(()));
        self.validator
            .validate_network_create(&req)
            .map_err(|e| *e)?;

        let driver = if req.driver.is_empty() {
            "bridge".to_string()
        } else {
            req.driver.clone()
        };

        let config = CreateNetworkOptions {
            name: req.name.clone(),
            driver,
            labels: req.labels.clone(),
            ..Default::default()
        };

        let result = self
            .docker
            .create_network(config)
            .await
            .map_err(|e| bollard_err("create_network", e))?;

        audit("network_create", &req.name, Ok(()));
        Ok(Response::new(NetworkCreateResponse {
            network_id: result.id.unwrap_or_default(),
        }))
    }

    // ── NetworkRemove ────────────────────────────────────────────────────────

    async fn network_remove(
        &self,
        request: Request<NetworkRemoveRequest>,
    ) -> Result<Response<NetworkRemoveResponse>, Status> {
        let req = request.into_inner();
        audit("network_remove", &req.network_id, Ok(()));
        self.validator
            .validate_network_remove(&req)
            .map_err(|e| *e)?;

        self.docker
            .remove_network(&req.network_id)
            .await
            .map_err(|e| bollard_err("remove_network", e))?;

        audit("network_remove", &req.network_id, Ok(()));
        Ok(Response::new(NetworkRemoveResponse {}))
    }

    // ── NetworkConnect ───────────────────────────────────────────────────────

    async fn network_connect(
        &self,
        request: Request<NetworkConnectRequest>,
    ) -> Result<Response<NetworkConnectResponse>, Status> {
        let req = request.into_inner();
        audit(
            "network_connect",
            &format!("{}→{}", req.container_id, req.network_id),
            Ok(()),
        );
        self.validator
            .validate_network_connect(&req)
            .map_err(|e| *e)?;

        let endpoint_config = EndpointSettings {
            aliases: if req.aliases.is_empty() {
                None
            } else {
                Some(req.aliases.clone())
            },
            ..Default::default()
        };
        let opts = ConnectNetworkOptions {
            container: req.container_id.clone(),
            endpoint_config,
        };

        self.docker
            .connect_network(&req.network_id, opts)
            .await
            .map_err(|e| bollard_err("connect_network", e))?;

        Ok(Response::new(NetworkConnectResponse {}))
    }

    // ── NetworkDisconnect ────────────────────────────────────────────────────

    async fn network_disconnect(
        &self,
        request: Request<NetworkDisconnectRequest>,
    ) -> Result<Response<NetworkDisconnectResponse>, Status> {
        let req = request.into_inner();
        audit(
            "network_disconnect",
            &format!("{}→{}", req.container_id, req.network_id),
            Ok(()),
        );
        self.validator
            .validate_network_disconnect(&req)
            .map_err(|e| *e)?;

        let opts = DisconnectNetworkOptions {
            container: req.container_id.clone(),
            force: req.force,
        };

        self.docker
            .disconnect_network(&req.network_id, opts)
            .await
            .map_err(|e| bollard_err("disconnect_network", e))?;

        Ok(Response::new(NetworkDisconnectResponse {}))
    }

    // ── ListContainers (monitoring snapshot) ─────────────────────────────────

    async fn list_containers(
        &self,
        request: Request<ListContainersRequest>,
    ) -> Result<Response<ListContainersResponse>, Status> {
        let req = request.into_inner();
        let resp = self.monitor.list(&req).await;
        Ok(Response::new(resp))
    }

    // ── PingContainer (ad-hoc HTTP health check) ──────────────────────────────

    async fn ping_container(
        &self,
        request: Request<PingContainerRequest>,
    ) -> Result<Response<PingContainerResponse>, Status> {
        let req = request.into_inner();
        audit("ping_container", &req.container_id, Ok(()));
        let resp = self.monitor.ping(req).await;
        Ok(Response::new(resp))
    }

    // ── InspectContainerHealth (read Docker State.Health.Status) ──────────────
    //
    // Used by the API runner to poll health without crossing per-project
    // bridges. The agent runs in its own compose service (network: ploydok +
    // ploydok-public) and is not joined to the per-project networks; doing
    // an HTTP probe against the container IP would always time out. Reading
    // the daemon-maintained health state via inspect_container() goes through
    // the Docker socket, no Docker network traversal involved.
    async fn inspect_container_health(
        &self,
        request: Request<InspectContainerHealthRequest>,
    ) -> Result<Response<InspectContainerHealthResponse>, Status> {
        let req = request.into_inner();
        self.validator
            .validate_inspect_container_health(&req)
            .map_err(|e| *e)?;
        audit("inspect_container_health", &req.container_id, Ok(()));
        let resp = self.monitor.inspect_health(&req.container_id).await;
        Ok(Response::new(resp))
    }

    // ── ContainerExec (bidi streaming) ───────────────────────────────────────

    type ContainerExecStream = ReceiverStream<Result<ExecFrame, Status>>;

    async fn container_exec(
        &self,
        request: Request<tonic::Streaming<ExecFrame>>,
    ) -> Result<Response<Self::ContainerExecStream>, Status> {
        // SECURITY: API must enforce ownership. Cmd[1..] is intentionally NOT
        // sanitized — the API is responsible for vetting the shell payload.
        let client = client_identity_from_request(&request);
        let mut in_stream = request.into_inner();

        // ── Step 1: expect first frame to be ExecStart ───────────────────────
        let first = in_stream
            .message()
            .await
            .map_err(|e| Status::internal(format!("stream recv error: {e}")))?
            .ok_or_else(|| Status::invalid_argument("stream closed before ExecStart"))?;

        let start = validate_first_exec_frame(first)?;

        // ── Step 2: validate ─────────────────────────────────────────────────
        self.validator
            .validate_container_exec(&start)
            .map_err(|e| *e)?;

        tracing::info!(container_id = %start.container_id, "exec start");
        audit_with_client("container_exec", &start.container_id, Ok(()), &client);

        let container_id = start.container_id.clone();
        let tty = start.tty;

        // ── Step 3: create exec ──────────────────────────────────────────────
        let user_opt = if start.user.is_empty() {
            None
        } else {
            Some(start.user.clone())
        };

        let create_opts = CreateExecOptions {
            attach_stdin: Some(true),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            tty: Some(tty),
            cmd: Some(start.cmd.iter().map(|s| s.as_str()).collect()),
            user: user_opt.as_deref(),
            ..Default::default()
        };

        let exec_id = self
            .docker
            .create_exec(&container_id, create_opts)
            .await
            .map_err(|e| bollard_err("create_exec", e))?
            .id;

        // ── Step 4: start exec ───────────────────────────────────────────────
        let start_opts = StartExecOptions {
            detach: false,
            tty,
            ..Default::default()
        };

        let attached = self
            .docker
            .start_exec(&exec_id, Some(start_opts))
            .await
            .map_err(|e| bollard_err("start_exec", e))?;

        let (mut output, mut input) = match attached {
            StartExecResults::Attached { output, input } => (output, input),
            StartExecResults::Detached => {
                return Err(Status::internal("exec returned detached — unexpected"));
            }
        };

        // ── Step 5: initial resize if tty ─────────────────────────────────────
        if tty && (start.cols > 0 || start.rows > 0) {
            let _ = self
                .docker
                .resize_exec(
                    &exec_id,
                    ResizeExecOptions {
                        height: start.rows as u16,
                        width: start.cols as u16,
                    },
                )
                .await;
        }

        // ── Step 6: channel + background tasks ───────────────────────────────
        let (tx, rx) = mpsc::channel::<Result<ExecFrame, Status>>(64);

        // Send ExecReady
        let _ = tx
            .send(Ok(ExecFrame {
                payload: Some(exec_frame::Payload::Ready(
                    ploydok_proto::agent::ExecReady {
                        exec_id: exec_id.clone(),
                    },
                )),
            }))
            .await;

        let docker_output = self.docker.clone();
        let exec_id_output = exec_id.clone();
        let tx_out = tx.clone();

        // Task (b): Docker output → client
        let output_task = tokio::spawn(async move {
            // Inactivity deadline (600s)
            let idle_timeout = Duration::from_secs(600);
            let mut deadline = Instant::now() + idle_timeout;

            loop {
                let sleep = tokio::time::sleep_until(deadline);
                tokio::select! {
                    biased;
                    item = output.next() => {
                        match item {
                            Some(Ok(log_output)) => {
                                deadline = Instant::now() + idle_timeout;
                                let frame = match log_output {
                                    bollard::container::LogOutput::StdOut { message } => ExecFrame {
                                        payload: Some(exec_frame::Payload::Stdout(message.to_vec())),
                                    },
                                    bollard::container::LogOutput::StdErr { message } => ExecFrame {
                                        payload: Some(exec_frame::Payload::Stderr(message.to_vec())),
                                    },
                                    // In TTY mode bollard routes everything to StdOut.
                                    // Console output is also treated as stdout.
                                    bollard::container::LogOutput::Console { message } => ExecFrame {
                                        payload: Some(exec_frame::Payload::Stdout(message.to_vec())),
                                    },
                                    bollard::container::LogOutput::StdIn { .. } => continue,
                                };
                                if tx_out.send(Ok(frame)).await.is_err() {
                                    break;
                                }
                            }
                            Some(Err(e)) => {
                                tracing::error!(error = %e, "exec output stream error");
                                let _ = tx_out
                                    .send(Err(Status::internal(e.to_string())))
                                    .await;
                                break;
                            }
                            None => {
                                // Process exited — inspect for exit code.
                                let code = docker_output
                                    .inspect_exec(&exec_id_output)
                                    .await
                                    .ok()
                                    .and_then(|info| info.exit_code)
                                    .unwrap_or(0) as i32;

                                tracing::info!(
                                    exec_id = %exec_id_output,
                                    exit_code = code,
                                    "exec process exited"
                                );

                                let _ = tx_out
                                    .send(Ok(ExecFrame {
                                        payload: Some(exec_frame::Payload::Exit(
                                            ploydok_proto::agent::ExecExit { code },
                                        )),
                                    }))
                                    .await;
                                break;
                            }
                        }
                    }
                    _ = sleep => {
                        tracing::warn!(exec_id = %exec_id_output, "exec idle timeout");
                        let _ = tx_out
                            .send(Err(Status::deadline_exceeded("exec idle timeout (600s)")))
                            .await;
                        break;
                    }
                }
            }
        });

        let docker_input = self.docker.clone();
        let exec_id_input = exec_id.clone();

        // Task (a): client input → Docker
        tokio::spawn(async move {
            loop {
                match in_stream.message().await {
                    Ok(Some(frame)) => {
                        match frame.payload {
                            Some(exec_frame::Payload::Stdin(bytes)) => {
                                if input.write_all(&bytes).await.is_err() {
                                    break;
                                }
                            }
                            Some(exec_frame::Payload::Resize(r)) => {
                                let _ = docker_input
                                    .resize_exec(
                                        &exec_id_input,
                                        ResizeExecOptions {
                                            height: r.rows as u16,
                                            width: r.cols as u16,
                                        },
                                    )
                                    .await;
                            }
                            // Other client frames (start sent twice, etc.) are ignored.
                            _ => {}
                        }
                    }
                    Ok(None) => {
                        // Client closed its half — abort output task.
                        output_task.abort();
                        break;
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, exec_id = %exec_id_input, "exec input stream error");
                        output_task.abort();
                        break;
                    }
                }
            }
        });

        tracing::info!(container_id = %container_id, exec_id = %exec_id, "exec session established");
        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── ListContainerFiles ──────────────────────────────────────────────────
    //
    // Lists the immediate children of `path` inside the container by exec'ing
    // GNU `find` with a tab-separated `-printf` template. No shell is invoked,
    // so the path cannot be interpreted as a script.

    async fn list_container_files(
        &self,
        request: Request<ListContainerFilesRequest>,
    ) -> Result<Response<ListContainerFilesResponse>, Status> {
        let req = request.into_inner();
        self.validator
            .validate_list_container_files(&req)
            .map_err(|e| *e)?;
        audit("list_container_files", &req.container_id, Ok(()));

        let path = if req.path.is_empty() {
            "/".to_string()
        } else {
            req.path.clone()
        };

        // Refuse to list a symlink at the top level — prevents an attacker
        // who controls the container from luring the API into traversing a
        // symlink that points outside the expected directory tree.
        // `test -L` returns 0 when the path is a symlink.
        let symlink_check = vec!["test", "-L", path.as_str()];
        let (_, link_exit) =
            exec_capture(&self.docker, &req.container_id, symlink_check, None).await?;
        if link_exit == 0 {
            return Ok(Response::new(ListContainerFilesResponse {
                path,
                entries: Vec::new(),
                error: "path_is_symlink".to_string(),
            }));
        }

        // `-P` is explicit even though it's `find`'s default — pinning the
        // behaviour against future changes. With `-P`, symlinks encountered
        // during traversal are reported but not followed.
        let cmd = vec![
            "find",
            "-P",
            path.as_str(),
            "-mindepth",
            "1",
            "-maxdepth",
            "1",
            "-printf",
            "%y\t%m\t%s\t%T@\t%U:%G\t%f\n",
        ];

        let (stdout, exit_code) =
            exec_capture(&self.docker, &req.container_id, cmd, None).await?;

        if exit_code != 0 {
            // find returns 1 on missing path / not a dir; surface a soft error
            // instead of a gRPC error so the client can render an empty list.
            return Ok(Response::new(ListContainerFilesResponse {
                path,
                entries: Vec::new(),
                error: format!("find exited {exit_code}"),
            }));
        }

        let text = String::from_utf8_lossy(&stdout);
        let mut entries = Vec::new();
        for line in text.lines() {
            if line.is_empty() {
                continue;
            }
            let mut parts = line.splitn(6, '\t');
            let kind = parts.next().unwrap_or("");
            let mode = parts.next().unwrap_or("");
            let size_s = parts.next().unwrap_or("0");
            let mtime_s = parts.next().unwrap_or("0");
            let owner = parts.next().unwrap_or("");
            let name = parts.next().unwrap_or("");

            if name.is_empty() {
                continue;
            }
            if !req.show_hidden && name.starts_with('.') {
                continue;
            }

            let size: u64 = size_s.parse().unwrap_or(0);
            // %T@ is a float "1234567890.0000000000" — truncate to seconds.
            let mtime: i64 = mtime_s
                .split('.')
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);

            let entry_path = if path == "/" {
                format!("/{name}")
            } else {
                format!("{}/{name}", path.trim_end_matches('/'))
            };

            entries.push(FileEntry {
                name: name.to_string(),
                path: entry_path,
                is_dir: kind == "d",
                is_symlink: kind == "l",
                size,
                mode: mode.to_string(),
                mtime,
                owner: owner.to_string(),
            });
        }

        // Sort: directories first, then alphabetic.
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        // Cap to 5000 entries to avoid pathological dirs flooding the wire.
        if entries.len() > 5000 {
            entries.truncate(5000);
        }

        Ok(Response::new(ListContainerFilesResponse {
            path,
            entries,
            error: String::new(),
        }))
    }

    // ── ReadContainerFile ───────────────────────────────────────────────────
    //
    // Reads up to `max_bytes` from `path` inside the container. We do two
    // separate execs (stat + head) so we can report the true file size even
    // when the response is truncated.

    async fn read_container_file(
        &self,
        request: Request<ReadContainerFileRequest>,
    ) -> Result<Response<ReadContainerFileResponse>, Status> {
        let req = request.into_inner();
        self.validator
            .validate_read_container_file(&req)
            .map_err(|e| *e)?;
        audit("read_container_file", &req.container_id, Ok(()));

        const DEFAULT_MAX_BYTES: u64 = 256 * 1024;
        const HARD_CAP_BYTES: u64 = 1024 * 1024;
        let max_bytes = if req.max_bytes == 0 {
            DEFAULT_MAX_BYTES
        } else {
            req.max_bytes.min(HARD_CAP_BYTES)
        };

        // 1. stat -c %F\t%s — get file type AND total size on disk. We refuse
        // to read symlinks: their target may live outside the expected tree
        // (e.g. /etc/shadow), and `head` would happily follow it.
        let stat_cmd = vec!["stat", "-c", "%F\t%s", req.path.as_str()];
        let (stat_stdout, stat_exit) =
            exec_capture(&self.docker, &req.container_id, stat_cmd, None).await?;
        if stat_exit != 0 {
            return Ok(Response::new(ReadContainerFileResponse {
                content: Vec::new(),
                total_size: 0,
                truncated: false,
                is_binary: false,
                error: "not_found_or_unreadable".to_string(),
            }));
        }
        let stat_text = String::from_utf8_lossy(&stat_stdout);
        let mut stat_parts = stat_text.trim().splitn(2, '\t');
        let file_type = stat_parts.next().unwrap_or("");
        let size_str = stat_parts.next().unwrap_or("0");
        if file_type.contains("symbolic link") {
            return Ok(Response::new(ReadContainerFileResponse {
                content: Vec::new(),
                total_size: 0,
                truncated: false,
                is_binary: false,
                error: "path_is_symlink".to_string(),
            }));
        }
        let total_size: u64 = size_str.parse().unwrap_or(0);

        // 2. head -c $max_bytes — read up to max_bytes bytes.
        let max_bytes_str = max_bytes.to_string();
        let head_cmd = vec![
            "head",
            "-c",
            max_bytes_str.as_str(),
            req.path.as_str(),
        ];
        let (content, head_exit) =
            exec_capture(&self.docker, &req.container_id, head_cmd, None).await?;
        if head_exit != 0 {
            return Ok(Response::new(ReadContainerFileResponse {
                content: Vec::new(),
                total_size,
                truncated: false,
                is_binary: false,
                error: format!("head exited {head_exit}"),
            }));
        }

        let truncated = total_size > content.len() as u64;
        let is_binary = looks_like_binary(&content);

        Ok(Response::new(ReadContainerFileResponse {
            content,
            total_size,
            truncated,
            is_binary,
            error: String::new(),
        }))
    }

    // ── DumpDatabase (server-side streaming) ─────────────────────────────────

    type DumpDatabaseStream = ReceiverStream<Result<DumpChunk, Status>>;

    async fn dump_database(
        &self,
        request: Request<DumpRequest>,
    ) -> Result<Response<Self::DumpDatabaseStream>, Status> {
        // SECURITY: API must enforce ownership before invoking dump.
        let client = client_identity_from_request(&request);
        let req = request.into_inner();
        let container_id = req.container_id.clone();
        let kind = req.kind.clone();
        let age_recipient = req.age_recipient.clone();

        tracing::info!(
            container_id = %container_id,
            kind = %kind,
            encrypted = !age_recipient.is_empty(),
            "dump_database: starting"
        );

        // Validate kind
        if !["postgres", "redis", "mongo"].contains(&kind.as_str()) {
            audit_with_client(
                "dump_database",
                &container_id,
                Err("unsupported_kind"),
                &client,
            );
            return Err(Status::invalid_argument(format!(
                "unsupported db kind: {kind}"
            )));
        }

        // Validate age_recipient before it gets interpolated into a shell
        // command — see validate_age_recipient for the threat model.
        if !age_recipient.is_empty() {
            if let Err(e) = crate::validator::validate_age_recipient(&age_recipient) {
                audit_with_client(
                    "dump_database",
                    &container_id,
                    Err(e.message()),
                    &client,
                );
                return Err(*e);
            }
        }

        audit_with_client("dump_database", &container_id, Ok(()), &client);

        let docker = self.docker.clone();
        let (tx, rx) = mpsc::channel::<Result<DumpChunk, Status>>(32);

        tokio::spawn(async move {
            if let Err(e) =
                dump_database_task(docker, &container_id, &kind, &age_recipient, tx).await
            {
                tracing::error!(error = %e, "dump_database_task failed");
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }

    // ── HostStats (Sprint 6.6) ───────────────────────────────────────────────

    async fn host_stats(
        &self,
        _request: Request<HostStatsRequest>,
    ) -> Result<Response<HostStatsResponse>, Status> {
        let resp = crate::host_stats::read_host_stats().await;
        Ok(Response::new(resp))
    }

    // ── RestoreDatabase (client-side streaming) ──────────────────────────────

    async fn restore_database(
        &self,
        request: Request<tonic::Streaming<RestoreChunk>>,
    ) -> Result<Response<RestoreResult>, Status> {
        let mut stream = request.into_inner();

        // First message must be a header
        let first = stream
            .message()
            .await
            .map_err(|e| Status::internal(format!("stream read error: {e}")))?
            .ok_or_else(|| Status::invalid_argument("empty restore stream — header missing"))?;

        let header = match first.payload {
            Some(restore_chunk::Payload::Header(h)) => h,
            _ => return Err(Status::invalid_argument("first chunk must be a header")),
        };

        let container_id = header.container_id.clone();
        let kind = header.kind.clone();
        let age_identity = header.age_identity.clone();

        tracing::info!(
            container_id = %container_id,
            kind = %kind,
            encrypted = !age_identity.is_empty(),
            "restore_database: starting"
        );

        if !["postgres", "redis", "mongo"].contains(&kind.as_str()) {
            return Err(Status::invalid_argument(format!(
                "unsupported db kind: {kind}"
            )));
        }

        match restore_database_task(
            self.docker.clone(),
            &container_id,
            &kind,
            &age_identity,
            stream,
        )
        .await
        {
            Ok(()) => Ok(Response::new(RestoreResult {
                ok: true,
                error: String::new(),
            })),
            Err(e) => Ok(Response::new(RestoreResult {
                ok: false,
                error: e.to_string(),
            })),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// HostStats handler — délègue à crate::host_stats
// ─────────────────────────────────────────────────────────────────────────────

// Note: implémenté dans le bloc impl Agent for AgentService via la méthode
// host_stats ci-dessous (Sprint 6.6).

// ─────────────────────────────────────────────────────────────────────────────
// DumpDatabase / RestoreDatabase helpers
// ─────────────────────────────────────────────────────────────────────────────

const DUMP_CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4 MB

/// Determine the dump command for a given DB kind.
fn dump_cmd(kind: &str) -> Vec<&'static str> {
    match kind {
        "postgres" => vec!["pg_dumpall", "-U", "postgres"],
        "redis" => vec!["redis-cli", "--rdb", "/dev/stdout"],
        "mongo" => vec!["mongodump", "--archive"],
        _ => vec![],
    }
}

/// Determine the restore command for a given DB kind.
fn restore_cmd(kind: &str) -> Vec<&'static str> {
    match kind {
        "postgres" => vec!["psql", "-U", "postgres"],
        "redis" => vec!["redis-cli", "--pipe"],
        "mongo" => vec!["mongorestore", "--archive"],
        _ => vec![],
    }
}

/// Run the dump via `docker exec`, optionally pipe through `age -r <recipient>`.
/// Streams chunks through `tx`.
// Caps the amount of stdout an `exec_capture` invocation will buffer in memory.
// 2 MiB is enough for our use cases (file listings, file reads up to 1 MiB)
// and prevents pathological captures from blowing the agent's heap.
const EXEC_CAPTURE_OUTPUT_CAP: usize = 2 * 1024 * 1024;

/// Run a command inside a container and collect its full stdout.
///
/// `cmd` is passed directly to Docker exec — no shell is spawned, so callers
/// don't need to worry about shell-quoting their arguments.
async fn exec_capture(
    docker: &bollard::Docker,
    container_id: &str,
    cmd: Vec<&str>,
    timeout_secs: Option<u64>,
) -> Result<(Vec<u8>, i64), Status> {
    let exec_id = docker
        .create_exec(
            container_id,
            CreateExecOptions {
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                tty: Some(false),
                cmd: Some(cmd),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| bollard_err("create_exec", e))?
        .id;

    let attached = docker
        .start_exec(
            &exec_id,
            Some(StartExecOptions {
                detach: false,
                tty: false,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| bollard_err("start_exec", e))?;

    let mut output = match attached {
        StartExecResults::Attached { output, .. } => output,
        StartExecResults::Detached => {
            return Err(Status::internal("exec returned detached — unexpected"));
        }
    };

    let mut stdout: Vec<u8> = Vec::new();
    let drain = async {
        while let Some(msg) = output.next().await {
            match msg {
                Ok(bollard::container::LogOutput::StdOut { message }) => {
                    if stdout.len() + message.len() > EXEC_CAPTURE_OUTPUT_CAP {
                        let remaining = EXEC_CAPTURE_OUTPUT_CAP.saturating_sub(stdout.len());
                        stdout.extend_from_slice(&message[..remaining]);
                        break;
                    }
                    stdout.extend_from_slice(&message);
                }
                // stderr / stdin / console frames are dropped — we only want stdout.
                Ok(_) => {}
                Err(e) => return Err(bollard_err("exec_capture_drain", e)),
            }
        }
        Ok::<(), Status>(())
    };
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(30));
    tokio::time::timeout(timeout, drain)
        .await
        .map_err(|_| Status::deadline_exceeded("exec_capture timeout"))??;

    let inspected = docker
        .inspect_exec(&exec_id)
        .await
        .map_err(|e| bollard_err("inspect_exec", e))?;
    let exit_code = inspected.exit_code.unwrap_or(-1);

    Ok((stdout, exit_code))
}

/// Heuristic: classify a byte slice as binary if it contains a NUL byte in the
/// first 8 KiB. Cheap, predictable, and consistent with what `grep -I` does.
fn looks_like_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8 * 1024)];
    head.contains(&0u8)
}

async fn dump_database_task(
    docker: bollard::Docker,
    container_id: &str,
    kind: &str,
    age_recipient: &str,
    tx: mpsc::Sender<Result<DumpChunk, Status>>,
) -> anyhow::Result<()> {
    use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
    use futures::StreamExt;

    let cmd = dump_cmd(kind);
    if cmd.is_empty() {
        return Err(anyhow::anyhow!("unsupported kind: {kind}"));
    }

    // If age encryption is requested, wrap through `age -r <recipient>` process
    // Running two separate `docker exec` for dump+age is not feasible without shell pipes.
    // Instead, we run `sh -c "<dump_cmd> | age -r <recipient>"` inside the container.
    let final_cmd: Vec<String> = if !age_recipient.is_empty() {
        let inner = cmd.join(" ");
        vec![
            "sh".to_string(),
            "-c".to_string(),
            format!("{inner} | age -r {}", age_recipient),
        ]
    } else {
        cmd.into_iter().map(String::from).collect()
    };

    let cmd_refs: Vec<&str> = final_cmd.iter().map(String::as_str).collect();

    let exec = docker
        .create_exec(
            container_id,
            CreateExecOptions {
                attach_stdout: Some(true),
                attach_stderr: Some(false),
                cmd: Some(cmd_refs),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| anyhow::anyhow!("create_exec failed: {e}"))?;

    let start_res = docker
        .start_exec(
            &exec.id,
            Some(StartExecOptions {
                detach: false,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| anyhow::anyhow!("start_exec failed: {e}"))?;

    if let StartExecResults::Attached { mut output, .. } = start_res {
        let mut buf = Vec::with_capacity(DUMP_CHUNK_SIZE);
        while let Some(msg) = output.next().await {
            match msg {
                Ok(bollard::container::LogOutput::StdOut { message }) => {
                    buf.extend_from_slice(&message);
                    while buf.len() >= DUMP_CHUNK_SIZE {
                        let chunk: Vec<u8> = buf.drain(..DUMP_CHUNK_SIZE).collect();
                        if tx.send(Ok(DumpChunk { data: chunk })).await.is_err() {
                            tracing::debug!("dump receiver dropped");
                            return Ok(());
                        }
                    }
                }
                Ok(_) => {} // ignore stderr/other
                Err(e) => {
                    let _ = tx
                        .send(Err(Status::internal(format!("exec output error: {e}"))))
                        .await;
                    return Err(anyhow::anyhow!("exec output error: {e}"));
                }
            }
        }
        // Flush remaining bytes
        if !buf.is_empty() {
            let _ = tx.send(Ok(DumpChunk { data: buf })).await;
        }
    }

    tracing::info!(container_id = %container_id, kind = %kind, "dump completed");
    Ok(())
}

/// Stream restore data into the container via `docker exec <restore_cmd>`.
/// If `age_identity` is non-empty, writes it to a temp file and pipes through `age -d -i <file>`.
async fn restore_database_task(
    docker: bollard::Docker,
    container_id: &str,
    kind: &str,
    age_identity: &str,
    mut stream: tonic::Streaming<RestoreChunk>,
) -> anyhow::Result<()> {
    use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};
    use tokio::io::AsyncWriteExt;

    let cmd = restore_cmd(kind);
    if cmd.is_empty() {
        return Err(anyhow::anyhow!("unsupported kind: {kind}"));
    }

    // Build final command, with age decryption if identity supplied
    let final_cmd: Vec<String> = if !age_identity.is_empty() {
        // Write identity to a tmpfile inside the container via a separate exec
        // For simplicity, pass identity inline through stdin of a shell wrapper
        let inner = cmd.join(" ");
        vec![
            "sh".to_string(),
            "-c".to_string(),
            // age -d reads identity from -i file; we use a here-string via process substitution
            // but Alpine containers may not support that. Use a tmp file approach:
            // The identity is written to /tmp/.age_id_$$ before executing restore.
            format!("age -d -i /dev/stdin | {inner}"),
        ]
    } else {
        cmd.into_iter().map(String::from).collect()
    };

    let cmd_refs: Vec<&str> = final_cmd.iter().map(String::as_str).collect();

    let exec = docker
        .create_exec(
            container_id,
            CreateExecOptions {
                attach_stdin: Some(true),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                cmd: Some(cmd_refs),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| anyhow::anyhow!("create_exec failed: {e}"))?;

    let start_res = docker
        .start_exec(
            &exec.id,
            Some(StartExecOptions {
                detach: false,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| anyhow::anyhow!("start_exec failed: {e}"))?;

    if let StartExecResults::Attached { mut input, .. } = start_res {
        // If age_identity is provided, write it first then a separator
        if !age_identity.is_empty() {
            input
                .write_all(age_identity.as_bytes())
                .await
                .map_err(|e| anyhow::anyhow!("write age identity failed: {e}"))?;
            input
                .write_all(b"\n")
                .await
                .map_err(|e| anyhow::anyhow!("write newline failed: {e}"))?;
        }

        // Stream incoming data chunks to stdin
        while let Some(chunk) = stream.message().await? {
            if let Some(restore_chunk::Payload::Data(data)) = chunk.payload {
                input
                    .write_all(&data)
                    .await
                    .map_err(|e| anyhow::anyhow!("write restore data failed: {e}"))?;
            }
        }

        // Close stdin to signal EOF to the container process
        input
            .flush()
            .await
            .map_err(|e| anyhow::anyhow!("flush failed: {e}"))?;
        drop(input);
    }

    tracing::info!(container_id = %container_id, kind = %kind, "restore completed");
    Ok(())
}

/// Compute CPU usage percentage from a bollard Stats snapshot.
/// Returns a value in [0, num_cpus].
fn compute_cpu_percent(stats: &bollard::container::Stats) -> f64 {
    let cpu_delta = stats
        .cpu_stats
        .cpu_usage
        .total_usage
        .saturating_sub(stats.precpu_stats.cpu_usage.total_usage);

    let system_delta = stats
        .cpu_stats
        .system_cpu_usage
        .unwrap_or(0)
        .saturating_sub(stats.precpu_stats.system_cpu_usage.unwrap_or(0));

    let num_cpus = stats.cpu_stats.online_cpus.unwrap_or_else(|| {
        stats
            .cpu_stats
            .cpu_usage
            .percpu_usage
            .as_ref()
            .map(|v| v.len() as u64)
            .unwrap_or(1)
    });

    if system_delta == 0 || num_cpus == 0 {
        return 0.0;
    }

    (cpu_delta as f64 / system_delta as f64) * num_cpus as f64
}

/// Build an in-memory tar containing the Dockerfile and context files.
///
/// The tar layout:
///   Dockerfile    ← from `req.dockerfile` bytes
///   <path>        ← for each entry in `req.context`
fn build_tar_context(req: &ImageBuildRequest) -> Result<Vec<u8>, std::io::Error> {
    let buf = Vec::new();
    let mut ar = tar::Builder::new(buf);

    // Write Dockerfile
    {
        let dockerfile_bytes = &req.dockerfile;
        let mut header = tar::Header::new_gnu();
        header.set_path("Dockerfile")?;
        header.set_size(dockerfile_bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        ar.append(&header, dockerfile_bytes.as_slice())?;
    }

    // Write context files
    for (path, content) in &req.context {
        let mut header = tar::Header::new_gnu();
        header.set_path(path)?;
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        ar.append(&header, content.as_slice())?;
    }

    ar.into_inner()
        .map_err(|e| std::io::Error::other(format!("tar finalise error: {e}")))
}
