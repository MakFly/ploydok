// SPDX-License-Identifier: AGPL-3.0-only
//
// Monitoring module — periodic docker stats poll + ad-hoc HTTP ping.
//
// Background task:
//   - every 2s, list containers managed by Ploydok (label ploydok.kind=*)
//   - for each, sample CPU%/mem via bollard stats (1 sample, non-streaming)
//   - cache snapshot in Arc<RwLock<HashMap<String, Snapshot>>>
//
// On ListContainers() RPC: return current cache (optionally filtered by kind).
// On PingContainer() RPC: do an HTTP GET against the container network IP + port + path.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use bollard::container::{ListContainersOptions, StatsOptions};
use futures::StreamExt;
use tokio::sync::RwLock;

use ploydok_proto::agent::{
    ContainerSnapshot, ListContainersRequest, ListContainersResponse, PingContainerRequest,
    PingContainerResponse,
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal snapshot (richer than proto — carries ping state)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub uptime_s: u64,
    pub cpu_pct: f64,
    pub mem_bytes: u64,
    pub mem_limit_bytes: u64,
    pub restart_count: u32,
    pub kind: String,
    pub app_id: String,
    pub color: String,
    /// (latency_ms, ok) from the last PingContainer call; None if never pinged.
    pub last_pong: Option<(u64, bool)>,
    pub last_seen_ms: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitor
// ─────────────────────────────────────────────────────────────────────────────

pub struct Monitor {
    cache: Arc<RwLock<HashMap<String, Snapshot>>>,
    docker: Arc<bollard::Docker>,
}

impl Monitor {
    pub fn new(docker: bollard::Docker) -> Arc<Self> {
        Arc::new(Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            docker: Arc::new(docker),
        })
    }

    /// Spawn the background polling task (2-second interval).
    /// Must be called once after construction, before serving RPCs.
    pub fn spawn_poll_task(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                self.poll_once().await;
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
    }

    /// Single poll iteration — collect all ploydok-labelled containers + sample stats.
    async fn poll_once(&self) {
        // List containers with label "ploydok.kind" (any value).
        let mut filters: HashMap<&str, Vec<&str>> = HashMap::new();
        filters.insert("label", vec!["ploydok.kind"]);

        let options = ListContainersOptions {
            all: true,
            filters,
            ..Default::default()
        };

        let containers = match self.docker.list_containers(Some(options)).await {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "poll_once: list_containers failed");
                return;
            }
        };

        let now_ms = unix_now_ms();

        // Collecte en parallèle : chaque container fait inspect + stats en
        // concurrence. Sans ça, 3 containers × ~2s (stream 2 frames) = 6s
        // sérialisé > interval 2s → les snapshots restent à 0 plusieurs cycles.
        let futures = containers.into_iter().map(|c| self.build_snapshot(c, now_ms));
        let snapshots = futures::future::join_all(futures).await;

        let mut cache = self.cache.write().await;
        for snap in snapshots.into_iter().flatten() {
            cache.insert(snap.id.clone(), snap);
        }
    }

    async fn build_snapshot(
        &self,
        c: bollard::models::ContainerSummary,
        now_ms: u64,
    ) -> Option<Snapshot> {
        {
            let id = match &c.id {
                Some(id) => id.clone(),
                None => return None,
            };

            let name = c
                .names
                .as_ref()
                .and_then(|v| v.first())
                .cloned()
                .unwrap_or_default()
                .trim_start_matches('/')
                .to_string();

            let image = c.image.clone().unwrap_or_default();

            let labels = c.labels.clone().unwrap_or_default();
            let kind = labels.get("ploydok.kind").cloned().unwrap_or_default();
            let app_id = labels.get("ploydok.app_id").cloned().unwrap_or_default();
            let color = labels.get("ploydok.color").cloned().unwrap_or_default();

            // Map bollard status string → our canonical status.
            let bollard_status = c.status.as_deref().unwrap_or("");
            let bollard_state = c.state.as_deref().unwrap_or("");
            let status = map_status(bollard_state, bollard_status);

            // Inspect pour récupérer restart_count + started_at (list_containers
            // ne les expose pas). Best-effort — on log et continue si ça rate.
            let (restart_count, uptime_s) = match self.docker.inspect_container(&id, None).await {
                Ok(info) => {
                    let rc = info
                        .restart_count
                        .and_then(|v| u32::try_from(v).ok())
                        .unwrap_or(0);
                    let up = info
                        .state
                        .as_ref()
                        .and_then(|s| s.started_at.as_deref())
                        .and_then(parse_iso8601_to_unix_secs)
                        .map(|started| {
                            let now_s = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs();
                            now_s.saturating_sub(started)
                        })
                        .unwrap_or(0);
                    let up = if status == "running" || status == "unhealthy" { up } else { 0 };
                    (rc, up)
                }
                Err(e) => {
                    tracing::debug!(container_id = %id, error = %e, "inspect failed");
                    (0, 0)
                }
            };

            // Sample stats (2 frames espacées pour avoir un cpu_delta non-nul).
            let (cpu_pct, mem_bytes, mem_limit_bytes) =
                sample_stats(&self.docker, &id).await;

            // Preserve existing ping result if present.
            let last_pong = {
                let guard = self.cache.read().await;
                guard.get(&id).and_then(|s| s.last_pong)
            };

            Some(Snapshot {
                id,
                name,
                image,
                status,
                uptime_s,
                cpu_pct,
                mem_bytes,
                mem_limit_bytes,
                restart_count,
                kind,
                app_id,
                color,
                last_pong,
                last_seen_ms: now_ms,
            })
        }
    }

    /// Return a list of proto `ContainerSnapshot`, optionally filtered by kind.
    pub async fn list(&self, req: &ListContainersRequest) -> ListContainersResponse {
        let guard = self.cache.read().await;
        let kind_filter = req.kind_filter.as_str();

        let containers: Vec<ContainerSnapshot> = guard
            .values()
            .filter(|s| kind_filter.is_empty() || s.kind == kind_filter)
            .map(snapshot_to_proto)
            .collect();

        ListContainersResponse { containers }
    }

    /// Perform an HTTP GET ping against the container's first network IP.
    pub async fn ping(&self, req: PingContainerRequest) -> PingContainerResponse {
        // Validate path length.
        if req.path.len() > 256 {
            return PingContainerResponse {
                ok: false,
                status_code: 0,
                latency_ms: 0,
                error: "path exceeds 256 characters".to_string(),
            };
        }
        if req.path.is_empty() {
            return PingContainerResponse {
                ok: false,
                status_code: 0,
                latency_ms: 0,
                error: "path is mandatory".to_string(),
            };
        }

        // Resolve container IP via inspect.
        let ip = match self.resolve_container_ip(&req.container_id).await {
            Ok(ip) => ip,
            Err(e) => {
                return PingContainerResponse {
                    ok: false,
                    status_code: 0,
                    latency_ms: 0,
                    error: format!("inspect error: {e}"),
                };
            }
        };

        let timeout_ms = req.timeout_ms.min(5000) as u64;
        let url = format!("http://{}:{}{}", ip, req.port, req.path);

        let client = match reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms.max(100)))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                return PingContainerResponse {
                    ok: false,
                    status_code: 0,
                    latency_ms: 0,
                    error: format!("http client build error: {e}"),
                };
            }
        };

        let start = std::time::Instant::now();
        let result = client.get(&url).send().await;
        let latency_ms = start.elapsed().as_millis() as u64;

        let resp = match result {
            Ok(r) => {
                let status_code = r.status().as_u16() as u32;
                let ok = r.status().is_success();
                PingContainerResponse {
                    ok,
                    status_code,
                    latency_ms,
                    error: String::new(),
                }
            }
            Err(e) => PingContainerResponse {
                ok: false,
                status_code: 0,
                latency_ms,
                error: e.to_string(),
            },
        };

        // Update cached ping result.
        let mut guard = self.cache.write().await;
        if let Some(snap) = guard.get_mut(&req.container_id) {
            snap.last_pong = Some((latency_ms, resp.ok));
        }

        resp
    }

    /// Resolve the first available network IP for a container via Docker inspect.
    async fn resolve_container_ip(&self, container_id: &str) -> anyhow::Result<String> {
        let info = self.docker.inspect_container(container_id, None).await?;

        let ip = info
            .network_settings
            .as_ref()
            .and_then(|ns| ns.networks.as_ref())
            .and_then(|nets| nets.values().next())
            .and_then(|ep| ep.ip_address.clone())
            .filter(|ip| !ip.is_empty())
            .ok_or_else(|| anyhow::anyhow!("no network IP found for container {}", container_id))?;

        Ok(ip)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Sample 2 stats frames espacées et calcule CPU% à partir de la 2e (qui aura
/// des `precpu_stats` non-nuls, nécessaires pour la formule cpu_delta).
/// `one_shot=true` renvoie une seule frame avec precpu=0 → cpu_pct=0, inutile.
/// Returns (0.0, 0, 0) on any error — poll loop must not crash.
async fn sample_stats(docker: &bollard::Docker, id: &str) -> (f64, u64, u64) {
    let options = StatsOptions {
        stream: true,
        one_shot: false,
    };

    let mut stream = docker.stats(id, Some(options));

    // Skip la première frame (sert de baseline precpu_stats).
    let _first = stream.next().await;

    // La seconde frame contient un cpu_delta exploitable.
    match stream.next().await {
        Some(Ok(stats)) => {
            let cpu_pct = compute_cpu_percent(&stats);
            let mem_bytes = stats
                .memory_stats
                .usage
                // Fallback cgroup v2 rootless : `usage` peut être None, lire
                // anon + file depuis la variante V2 comme proxy.
                .or_else(|| match stats.memory_stats.stats {
                    Some(bollard::container::MemoryStatsStats::V2(v2)) => {
                        Some(v2.anon + v2.file)
                    }
                    _ => None,
                })
                .unwrap_or(0);
            let mem_limit_bytes = stats.memory_stats.limit.unwrap_or(0);
            (cpu_pct, mem_bytes, mem_limit_bytes)
        }
        Some(Err(e)) => {
            tracing::debug!(container_id = %id, error = %e, "sample_stats: stats error");
            (0.0, 0, 0)
        }
        None => (0.0, 0, 0),
    }
}

/// Parse un timestamp ISO 8601 (ex. "2026-04-17T09:31:05.123456789Z") vers
/// Unix secondes. Retourne None si invalide ou zero time ("0001-01-01T…").
fn parse_iso8601_to_unix_secs(s: &str) -> Option<u64> {
    if s.starts_with("0001-") || s.is_empty() {
        return None;
    }
    // Parse le format RFC3339 à la main (sans dépendre de chrono).
    // Format attendu: YYYY-MM-DDTHH:MM:SS[.fraction]Z
    let date_end = s.find('T')?;
    let (date, rest) = s.split_at(date_end);
    let rest = &rest[1..];
    let time_end = rest.find(['.', 'Z', '+', '-'])?;
    let time = &rest[..time_end];

    let mut dparts = date.split('-');
    let year: i32 = dparts.next()?.parse().ok()?;
    let month: u32 = dparts.next()?.parse().ok()?;
    let day: u32 = dparts.next()?.parse().ok()?;

    let mut tparts = time.split(':');
    let hour: u32 = tparts.next()?.parse().ok()?;
    let min: u32 = tparts.next()?.parse().ok()?;
    let sec: u32 = tparts.next()?.parse().ok()?;

    // Algorithme Howard Hinnant — days_from_civil.
    // https://howardhinnant.github.io/date_algorithms.html#days_from_civil
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y / 400 } else { (y - 399) / 400 };
    let yoe = (y - era * 400) as u32;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_since_epoch: i64 = era as i64 * 146_097 + doe as i64 - 719_468;

    let secs = days_since_epoch * 86_400
        + hour as i64 * 3_600
        + min as i64 * 60
        + sec as i64;

    if secs < 0 { None } else { Some(secs as u64) }
}

/// Compute CPU usage percentage (0–100 × num_cpus) from a bollard Stats snapshot.
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

    (cpu_delta as f64 / system_delta as f64) * num_cpus as f64 * 100.0
}

/// Map bollard container state/status strings to our canonical status string.
///
/// Docker `State.Status` values: "created", "restarting", "running", "removing",
/// "paused", "exited", "dead".
/// Docker `State.Health.Status`: "healthy", "unhealthy", "starting", "none".
fn map_status(state: &str, status: &str) -> String {
    match state {
        "running" => {
            // Check if the status string mentions "(unhealthy)"
            if status.contains("unhealthy") {
                "unhealthy".to_string()
            } else {
                "running".to_string()
            }
        }
        "created" | "restarting" => "starting".to_string(),
        "exited" | "dead" | "paused" | "removing" => "stopped".to_string(),
        _ => {
            // Fallback: inspect the status string (e.g. "Up 2 hours (healthy)")
            if status.starts_with("Up") {
                if status.contains("unhealthy") {
                    "unhealthy".to_string()
                } else {
                    "running".to_string()
                }
            } else if status.starts_with("Exited") || status.starts_with("Dead") {
                "stopped".to_string()
            } else {
                "unknown".to_string()
            }
        }
    }
}

/// Convert an internal `Snapshot` to a proto `ContainerSnapshot`.
fn snapshot_to_proto(s: &Snapshot) -> ContainerSnapshot {
    let (last_ping_ms, last_ping_ok) = s.last_pong.unwrap_or((0, false));
    ContainerSnapshot {
        id: s.id.clone(),
        name: s.name.clone(),
        image: s.image.clone(),
        status: s.status.clone(),
        uptime_s: s.uptime_s,
        cpu_pct: s.cpu_pct,
        mem_bytes: s.mem_bytes,
        mem_limit_bytes: s.mem_limit_bytes,
        restart_count: s.restart_count,
        kind: s.kind.clone(),
        app_id: s.app_id.clone(),
        color: s.color.clone(),
        last_ping_ms,
        last_ping_ok,
        last_seen_ms: s.last_seen_ms,
    }
}

/// Current Unix time in milliseconds.
fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
