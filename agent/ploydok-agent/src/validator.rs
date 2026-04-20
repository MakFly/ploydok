// SPDX-License-Identifier: AGPL-3.0-only
//
// Validator trait — called by AgentService before each Docker operation.
//
// Implementations:
//   - `PermissiveValidator` : no-op, development only.
//   - `StrictValidator`     : production allowlist enforcement (task 2.3).

use std::path::Path;

use ploydok_proto::agent::{
    ContainerCreateRequest, ContainerRemoveRequest, ContainerStartRequest, ContainerStopRequest,
    ExecStart, ImageBuildRequest, ImagePullRequest, NetworkCreateRequest, NetworkRemoveRequest,
};
use serde::{Deserialize, Serialize};
use tonic::Status;

/// Validation error type — `Box<Status>` keeps the trait method return type
/// small enough for clippy's `result_large_err` lint (tonic::Status is 176 bytes).
pub type ValidatorResult = Result<(), Box<Status>>;

/// Validation hook called before every RPC.
///
/// Each method receives the decoded request proto and returns `Ok(())` if the
/// operation is allowed, or a boxed [`Status`] (typically `PermissionDenied` /
/// `InvalidArgument`) if it should be rejected.
pub trait Validator: Send + Sync + 'static {
    fn validate_container_create(&self, req: &ContainerCreateRequest) -> ValidatorResult;
    fn validate_container_start(&self, req: &ContainerStartRequest) -> ValidatorResult;
    fn validate_container_stop(&self, req: &ContainerStopRequest) -> ValidatorResult;
    fn validate_container_remove(&self, req: &ContainerRemoveRequest) -> ValidatorResult;
    fn validate_image_pull(&self, req: &ImagePullRequest) -> ValidatorResult;
    fn validate_image_build(&self, req: &ImageBuildRequest) -> ValidatorResult;
    fn validate_network_create(&self, req: &NetworkCreateRequest) -> ValidatorResult;
    fn validate_network_remove(&self, req: &NetworkRemoveRequest) -> ValidatorResult;
    fn validate_container_exec(&self, req: &ExecStart) -> ValidatorResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// PermissiveValidator — always allows everything (development / testing only)
// ─────────────────────────────────────────────────────────────────────────────

/// No-op validator used for development and integration tests.
///
/// **WARNING**: this must never be used in production. Replace with
/// `StrictValidator` when deploying.
#[allow(dead_code)]
pub struct PermissiveValidator;

impl Validator for PermissiveValidator {
    fn validate_container_create(&self, _req: &ContainerCreateRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_container_start(&self, _req: &ContainerStartRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_container_stop(&self, _req: &ContainerStopRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_container_remove(&self, _req: &ContainerRemoveRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_image_pull(&self, _req: &ImagePullRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_image_build(&self, _req: &ImageBuildRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_network_create(&self, _req: &NetworkCreateRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_network_remove(&self, _req: &NetworkRemoveRequest) -> ValidatorResult {
        Ok(())
    }
    fn validate_container_exec(&self, _req: &ExecStart) -> ValidatorResult {
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorConfig — deserialisable from TOML/JSON or env defaults
// ─────────────────────────────────────────────────────────────────────────────

/// Configuration for `StrictValidator`.
///
/// Can be built from TOML/JSON or constructed programmatically.
/// All fields have sensible defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorConfig {
    /// Registries allowed for image pulls and container creation.
    /// Default: `["docker.io", "ghcr.io", "registry.ploydok.io"]`
    #[serde(default = "default_allowed_registries")]
    pub allowed_registries: Vec<String>,

    /// Root prefix allowed for host-side volume mounts.
    /// Default: `/var/lib/ploydok/volumes`
    #[serde(default = "default_volume_prefix")]
    pub volume_prefix: String,

    /// Maximum fractional CPUs allowed in resource limits.
    /// Default: `4.0`
    #[serde(default = "default_max_cpu")]
    pub max_cpu: f64,

    /// Maximum memory in bytes allowed in resource limits.
    /// Default: `8 * 1024^3` (8 GiB)
    #[serde(default = "default_max_memory_bytes")]
    pub max_memory_bytes: i64,
}

fn default_allowed_registries() -> Vec<String> {
    vec![
        "docker.io".to_string(),
        "ghcr.io".to_string(),
        "registry.ploydok.io".to_string(),
    ]
}

fn default_volume_prefix() -> String {
    "/var/lib/ploydok/volumes".to_string()
}

fn default_max_cpu() -> f64 {
    4.0
}

fn default_max_memory_bytes() -> i64 {
    8 * 1024 * 1024 * 1024 // 8 GiB
}

impl Default for ValidatorConfig {
    fn default() -> Self {
        Self {
            allowed_registries: default_allowed_registries(),
            volume_prefix: default_volume_prefix(),
            max_cpu: default_max_cpu(),
            max_memory_bytes: default_max_memory_bytes(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// StrictValidator — production allowlist enforcement
// ─────────────────────────────────────────────────────────────────────────────

/// Production validator enforcing the Ploydok allowlist policy.
///
/// Constructed via [`StrictValidator::new`] with a [`ValidatorConfig`].
/// All violations return a boxed [`Status`] with `permission_denied` or
/// `invalid_argument` codes and a JSON detail in the message.
pub struct StrictValidator {
    cfg: ValidatorConfig,
}

impl StrictValidator {
    pub fn new(cfg: ValidatorConfig) -> Self {
        Self { cfg }
    }

    /// Build from environment variable `PLOYDOK_VALIDATOR_CONFIG` (path to TOML/JSON file),
    /// or return the default config if not set.
    pub fn from_env() -> anyhow::Result<Self> {
        let cfg = if let Ok(path) = std::env::var("PLOYDOK_VALIDATOR_CONFIG") {
            let content = std::fs::read_to_string(&path)?;
            let ext = Path::new(&path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("json");
            if ext == "toml" {
                toml::from_str(&content)?
            } else {
                serde_json::from_str(&content)?
            }
        } else {
            ValidatorConfig::default()
        };
        Ok(Self::new(cfg))
    }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/// Build a denied `Status` with a JSON-encoded rule detail in the message.
fn deny(code: tonic::Code, rule: &str, detail: impl Serialize) -> Box<Status> {
    let detail_json = serde_json::to_string(&detail).unwrap_or_else(|_| "{}".to_string());
    let msg = format!("Requête refusée — règle: {rule} — {detail_json}");
    tracing::warn!(rule = rule, detail = %detail_json, "validator: accès refusé");
    Box::new(Status::new(code, msg))
}

/// Extract the registry from an image reference.
///
/// Rules (mirroring Docker client conventions):
/// - If reference contains a `/` and the part before the first `/` contains a
///   `.` or `:` or is `localhost`, it is the registry.
/// - Otherwise the registry is `docker.io`.
fn extract_registry(image: &str) -> &str {
    // Strip tag/digest for registry extraction.
    let without_tag = if let Some(at) = image.find('@') {
        &image[..at]
    } else {
        image
    };
    if let Some(slash) = without_tag.find('/') {
        let candidate = &without_tag[..slash];
        if candidate.contains('.') || candidate.contains(':') || candidate == "localhost" {
            return candidate;
        }
    }
    "docker.io"
}

/// Validate that a `host_path` is under `volume_prefix` without path traversal.
///
/// Returns `Ok(())` on success, or the violated path as `Err(String)`.
fn validate_host_path(host_path: &str, volume_prefix: &str) -> Result<(), String> {
    // Reject null bytes and obvious traversal sequences before any canonicalisation.
    if host_path.contains('\0') || host_path.contains("..") {
        return Err(format!(
            "path traversal détecté dans host_path: {host_path}"
        ));
    }
    // The path must start with the allowed prefix.
    let prefix = volume_prefix.trim_end_matches('/');
    if !host_path.starts_with(&format!("{prefix}/")) && host_path != prefix {
        return Err(format!(
            "host_path '{host_path}' hors du préfixe autorisé '{prefix}/'"
        ));
    }
    Ok(())
}

// ─── Validator impl ──────────────────────────────────────────────────────────

impl Validator for StrictValidator {
    fn validate_container_create(&self, req: &ContainerCreateRequest) -> ValidatorResult {
        // 1. Name: must match ^ploydok-[a-z0-9][a-z0-9-]{0,62}$
        {
            let name_re =
                regex_lite::Regex::new(r"^ploydok-[a-z0-9][a-z0-9-]{0,62}$").expect("static regex");
            if !name_re.is_match(&req.name) {
                return Err(deny(
                    tonic::Code::InvalidArgument,
                    "container_name_prefix",
                    serde_json::json!({
                        "name": &req.name,
                        "expected": "^ploydok-[a-z0-9][a-z0-9-]{0,62}$"
                    }),
                ));
            }
        }

        // 2. Image registry allowlist.
        {
            let registry = extract_registry(&req.image);
            if !self.cfg.allowed_registries.iter().any(|r| r == registry) {
                return Err(deny(
                    tonic::Code::PermissionDenied,
                    "image_registry_allowlist",
                    serde_json::json!({
                        "image": &req.image,
                        "registry": registry,
                        "allowed": &self.cfg.allowed_registries
                    }),
                ));
            }
        }

        // 3. Volume host paths: under /var/lib/ploydok/volumes/, no traversal.
        for vol in &req.volumes {
            if let Err(reason) = validate_host_path(&vol.host_path, &self.cfg.volume_prefix) {
                return Err(deny(
                    tonic::Code::PermissionDenied,
                    "volume_host_path",
                    serde_json::json!({ "host_path": &vol.host_path, "reason": reason }),
                ));
            }
        }

        // 4. Labels: must contain non-empty ploydok.app_id and ploydok.owner_id.
        for key in &["ploydok.app_id", "ploydok.owner_id"] {
            match req.labels.get(*key) {
                Some(v) if !v.is_empty() => {}
                _ => {
                    return Err(deny(
                        tonic::Code::InvalidArgument,
                        "required_labels",
                        serde_json::json!({ "missing_label": key }),
                    ));
                }
            }
        }

        // 5. Network(s): empty or matching ploydok-*; never "host".
        // Validate both the legacy single-string `network` field AND the new
        // repeated `networks` field (sprint-3bis multi-network support).
        let mut net_candidates: Vec<&str> = Vec::new();
        if !req.network.is_empty() {
            net_candidates.push(&req.network);
        }
        for n in &req.networks {
            if !n.is_empty() {
                net_candidates.push(n);
            }
        }
        for n in &net_candidates {
            if *n == "host" {
                return Err(deny(
                    tonic::Code::PermissionDenied,
                    "network_host_forbidden",
                    serde_json::json!({ "network": n }),
                ));
            }
            if !n.starts_with("ploydok-") {
                return Err(deny(
                    tonic::Code::PermissionDenied,
                    "network_prefix",
                    serde_json::json!({ "network": n, "expected_prefix": "ploydok-" }),
                ));
            }
        }

        // 6. User: must not be root/0 if specified.
        if !req.user.is_empty()
            && (req.user == "root" || req.user == "0" || req.user.starts_with("0:"))
        {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "user_root_forbidden",
                serde_json::json!({ "user": &req.user }),
            ));
        }

        // 7. Resource limits: cpu ≤ max_cpu, memory ≤ max_memory_bytes.
        if let Some(limits) = &req.resource_limits {
            if limits.cpu > self.cfg.max_cpu && limits.cpu > 0.0 {
                return Err(deny(
                    tonic::Code::InvalidArgument,
                    "resource_cpu_limit",
                    serde_json::json!({
                        "cpu": limits.cpu,
                        "max_cpu": self.cfg.max_cpu
                    }),
                ));
            }
            if limits.memory_bytes > self.cfg.max_memory_bytes && limits.memory_bytes > 0 {
                return Err(deny(
                    tonic::Code::InvalidArgument,
                    "resource_memory_limit",
                    serde_json::json!({
                        "memory_bytes": limits.memory_bytes,
                        "max_memory_bytes": self.cfg.max_memory_bytes
                    }),
                ));
            }
        }

        Ok(())
    }

    fn validate_container_start(&self, req: &ContainerStartRequest) -> ValidatorResult {
        // Containers are only created through our flow (which enforces the ploydok- prefix),
        // so for start/stop/remove by id we accept the request — the label check is done
        // at create time. We still enforce that the id/name is non-empty.
        if req.container_id.is_empty() {
            return Err(deny(
                tonic::Code::InvalidArgument,
                "container_id_empty",
                serde_json::json!({ "container_id": "" }),
            ));
        }
        // If the caller passes a name (not a sha256 id), enforce ploydok- prefix.
        if !req.container_id.starts_with("sha256:")
            && !looks_like_short_id(&req.container_id)
            && !req.container_id.starts_with("ploydok-")
        {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "container_name_prefix",
                serde_json::json!({ "container_id": &req.container_id }),
            ));
        }
        Ok(())
    }

    fn validate_container_stop(&self, req: &ContainerStopRequest) -> ValidatorResult {
        if req.container_id.is_empty() {
            return Err(deny(
                tonic::Code::InvalidArgument,
                "container_id_empty",
                serde_json::json!({ "container_id": "" }),
            ));
        }
        if !req.container_id.starts_with("sha256:")
            && !looks_like_short_id(&req.container_id)
            && !req.container_id.starts_with("ploydok-")
        {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "container_name_prefix",
                serde_json::json!({ "container_id": &req.container_id }),
            ));
        }
        Ok(())
    }

    fn validate_container_remove(&self, req: &ContainerRemoveRequest) -> ValidatorResult {
        if req.container_id.is_empty() {
            return Err(deny(
                tonic::Code::InvalidArgument,
                "container_id_empty",
                serde_json::json!({ "container_id": "" }),
            ));
        }
        if !req.container_id.starts_with("sha256:")
            && !looks_like_short_id(&req.container_id)
            && !req.container_id.starts_with("ploydok-")
        {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "container_name_prefix",
                serde_json::json!({ "container_id": &req.container_id }),
            ));
        }
        Ok(())
    }

    fn validate_image_pull(&self, req: &ImagePullRequest) -> ValidatorResult {
        let registry = extract_registry(&req.image);
        if !self.cfg.allowed_registries.iter().any(|r| r == registry) {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "image_registry_allowlist",
                serde_json::json!({
                    "image": &req.image,
                    "registry": registry,
                    "allowed": &self.cfg.allowed_registries
                }),
            ));
        }
        Ok(())
    }

    fn validate_image_build(&self, req: &ImageBuildRequest) -> ValidatorResult {
        // Tag must start with ploydok-.
        if !req.tag.starts_with("ploydok-") {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "image_build_tag_prefix",
                serde_json::json!({ "tag": &req.tag, "expected_prefix": "ploydok-" }),
            ));
        }
        Ok(())
    }

    fn validate_network_create(&self, req: &NetworkCreateRequest) -> ValidatorResult {
        // Name must start with ploydok-.
        if !req.name.starts_with("ploydok-") {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "network_name_prefix",
                serde_json::json!({ "name": &req.name, "expected_prefix": "ploydok-" }),
            ));
        }
        // Driver: only bridge allowed; reject host and macvlan.
        let driver = if req.driver.is_empty() {
            "bridge"
        } else {
            &req.driver
        };
        if driver == "host" || driver == "macvlan" {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "network_driver_forbidden",
                serde_json::json!({ "driver": driver, "allowed": ["bridge"] }),
            ));
        }
        Ok(())
    }

    fn validate_network_remove(&self, req: &NetworkRemoveRequest) -> ValidatorResult {
        if req.network_id.is_empty() {
            return Err(deny(
                tonic::Code::InvalidArgument,
                "network_id_empty",
                serde_json::json!({ "network_id": "" }),
            ));
        }
        // If the caller passes a name (not an opaque id), enforce ploydok- prefix.
        if !looks_like_network_id(&req.network_id) && !req.network_id.starts_with("ploydok-") {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "network_name_prefix",
                serde_json::json!({ "network_id": &req.network_id }),
            ));
        }
        Ok(())
    }

    fn validate_container_exec(&self, req: &ExecStart) -> ValidatorResult {
        // 1. container_id: non-empty; if a name (not sha256/short-id), must start with ploydok-.
        if req.container_id.is_empty() {
            return Err(deny(
                tonic::Code::InvalidArgument,
                "container_id_empty",
                serde_json::json!({ "container_id": "" }),
            ));
        }
        if !req.container_id.starts_with("sha256:")
            && !looks_like_short_id(&req.container_id)
            && !req.container_id.starts_with("ploydok-")
        {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "container_name_prefix",
                serde_json::json!({ "container_id": &req.container_id }),
            ));
        }

        // 2. cmd: at least one element; cmd[0] must be an allowed shell binary.
        if req.cmd.is_empty() {
            return Err(deny(
                tonic::Code::InvalidArgument,
                "exec_cmd_empty",
                serde_json::json!({ "cmd": serde_json::Value::Array(vec![]) }),
            ));
        }
        const ALLOWED_SHELLS: &[&str] = &["/bin/sh", "/bin/bash", "sh", "bash"];
        if !ALLOWED_SHELLS.contains(&req.cmd[0].as_str()) {
            return Err(deny(
                tonic::Code::PermissionDenied,
                "exec_cmd_not_allowed",
                serde_json::json!({
                    "cmd0": &req.cmd[0],
                    "allowed": ALLOWED_SHELLS
                }),
            ));
        }

        // 3. user: max 32 chars, alphanumeric + ":" (uid:gid or name).
        if !req.user.is_empty() {
            if req.user.len() > 32 {
                return Err(deny(
                    tonic::Code::InvalidArgument,
                    "exec_user_too_long",
                    serde_json::json!({ "user": &req.user, "max_len": 32 }),
                ));
            }
            if !req.user.chars().all(|c| c.is_alphanumeric() || c == ':') {
                return Err(deny(
                    tonic::Code::InvalidArgument,
                    "exec_user_invalid_chars",
                    serde_json::json!({
                        "user": &req.user,
                        "allowed_chars": "alphanumeric and ':'"
                    }),
                ));
            }
        }

        Ok(())
    }
}

// ─── ID heuristics ────────────────────────────────────────────────────────────

/// Returns true if `s` looks like a Docker short container id (12 hex chars)
/// or a full 64-char sha256 id (without the `sha256:` prefix).
fn looks_like_short_id(s: &str) -> bool {
    let len = s.len();
    (len == 12 || len == 64) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Returns true if `s` looks like a Docker network id (64 hex chars).
fn looks_like_network_id(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit())
}
