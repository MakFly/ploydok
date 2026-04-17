// SPDX-License-Identifier: AGPL-3.0-only
//
// AgentService — tonic gRPC service backed by bollard.
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
use bollard::image::{BuildImageOptions, CreateImageOptions};
use bollard::models::{HostConfig, PortBinding, RestartPolicy, RestartPolicyNameEnum};
use bollard::network::CreateNetworkOptions;
use futures::StreamExt;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status};

use ploydok_proto::agent::{
    agent_server::Agent, BuildProgress, ContainerCreateRequest, ContainerCreateResponse,
    ContainerLogsRequest, ContainerRemoveRequest, ContainerRemoveResponse, ContainerStartRequest,
    ContainerStartResponse, ContainerStatsRequest, ContainerStopRequest, ContainerStopResponse,
    ImageBuildRequest, ImagePullRequest, ListContainersRequest, ListContainersResponse, LogLine,
    NetworkCreateRequest, NetworkCreateResponse, NetworkRemoveRequest, NetworkRemoveResponse,
    PingContainerRequest, PingContainerResponse, PullProgress, StatsFrame,
};

use crate::audit::audit;
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

/// Map a bollard error to a tonic `Status::internal` and log it.
fn bollard_err(context: &str, err: bollard::errors::Error) -> Status {
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
        Self { docker, validator, monitor }
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
        let req = request.into_inner();
        audit("container_create", &req.name, Ok(()));

        self.validator
            .validate_container_create(&req)
            .inspect_err(|s| {
                audit("container_create", &req.name, Err(s.message()));
            })
            .map_err(|s| *s)?;

        // Build environment variables list.
        let env: Vec<String> = req
            .env
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();

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
            memory: req
                .resource_limits
                .as_ref()
                .and_then(|r| if r.memory_bytes > 0 { Some(r.memory_bytes) } else { None }),
            // bollard uses nano_cpus (1e9 per CPU core)
            nano_cpus: req.resource_limits.as_ref().and_then(|r| {
                if r.cpu > 0.0 {
                    Some((r.cpu * 1_000_000_000.0) as i64)
                } else {
                    None
                }
            }),
            ..Default::default()
        };

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
            user: if req.user.is_empty() { None } else { Some(req.user.clone()) },
            host_config: Some(host_config),
            // Network is attached via networking_config
            networking_config: if req.network.is_empty() {
                None
            } else {
                use bollard::container::NetworkingConfig;
                use bollard::models::EndpointSettings;
                let mut endpoints = HashMap::new();
                endpoints.insert(req.network.clone(), EndpointSettings::default());
                Some(NetworkingConfig {
                    endpoints_config: endpoints,
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

        audit("container_create", &req.name, Ok(()));
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
        self.validator.validate_container_start(&req).map_err(|e| *e)?;

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
        self.validator.validate_container_stop(&req).map_err(|e| *e)?;

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
        self.validator.validate_container_remove(&req).map_err(|e| *e)?;

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

                        let memory_bytes =
                            stats.memory_stats.usage.unwrap_or(0) as i64;
                        let memory_limit_bytes =
                            stats.memory_stats.limit.unwrap_or(0) as i64;

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

        let docker = self.docker.clone();
        let image = req.image.clone();

        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(async move {
            let mut stream = docker.create_image(Some(options), None, None);
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
            let mut stream =
                docker.build_image(options, None, Some(bytes::Bytes::from(tar_bytes)));
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
        self.validator.validate_network_create(&req).map_err(|e| *e)?;

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
        self.validator.validate_network_remove(&req).map_err(|e| *e)?;

        self.docker
            .remove_network(&req.network_id)
            .await
            .map_err(|e| bollard_err("remove_network", e))?;

        audit("network_remove", &req.network_id, Ok(()));
        Ok(Response::new(NetworkRemoveResponse {}))
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

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
