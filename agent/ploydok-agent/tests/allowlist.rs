// SPDX-License-Identifier: AGPL-3.0-only
//
// Allowlist tests — 10 tentatives d'actions interdites → 10 refus.
//
// Tests unitaires sur StrictValidator directement (pas de bollard nécessaire).

use ploydok_agent::validator::{StrictValidator, Validator, ValidatorConfig};
use ploydok_proto::agent::{
    ContainerCreateRequest, HealthcheckConfig, ImageBuildRequest, ImagePullRequest,
    NetworkCreateRequest, ResourceLimits, VolumeMount,
};
use tonic::Code;

/// Build a valid ContainerCreateRequest baseline (all rules satisfied).
fn valid_create() -> ContainerCreateRequest {
    ContainerCreateRequest {
        name: "ploydok-my-app".to_string(),
        image: "nginx:alpine".to_string(),
        env: Default::default(),
        labels: {
            let mut m = std::collections::HashMap::new();
            m.insert("ploydok.app_id".to_string(), "app-123".to_string());
            m.insert("ploydok.owner_id".to_string(), "owner-456".to_string());
            m
        },
        network: "ploydok-net".to_string(),
        volumes: vec![],
        ports: vec![],
        restart_policy: String::new(),
        resource_limits: None,
        command: vec![],
        user: String::new(),
        networks: vec![],
        healthcheck: None,
    }
}

fn make_validator() -> StrictValidator {
    StrictValidator::new(ValidatorConfig::default())
}

// ─── Test 1: name sans préfixe ploydok- ──────────────────────────────────────

#[test]
fn test_name_without_ploydok_prefix_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.name = "myapp-container".to_string();

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument, "mauvais code pour name");
    assert!(
        err.message().contains("container_name_prefix"),
        "message doit mentionner la règle: {}",
        err.message()
    );
}

// ─── Test 2: registry non autorisé ───────────────────────────────────────────

#[test]
fn test_evil_registry_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.image = "evil-registry.com/attacker/image:latest".to_string();

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("image_registry_allowlist"),
        "message doit mentionner image_registry_allowlist: {}",
        err.message()
    );
}

// ─── Test 3: bind-mount hors /var/lib/ploydok/volumes ────────────────────────

#[test]
fn test_volume_outside_prefix_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.volumes = vec![VolumeMount {
        host_path: "/home/user/data".to_string(),
        container_path: "/data".to_string(),
        read_only: false,
    }];

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("volume_host_path"),
        "message doit mentionner volume_host_path: {}",
        err.message()
    );
}

// ─── Test 4: path traversal ───────────────────────────────────────────────────

#[test]
fn test_path_traversal_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.volumes = vec![VolumeMount {
        host_path: "/var/lib/ploydok/volumes/../../etc".to_string(),
        container_path: "/etc".to_string(),
        read_only: false,
    }];

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("volume_host_path"),
        "message doit mentionner volume_host_path (traversal): {}",
        err.message()
    );
}

// ─── Test 5: labels manquants ─────────────────────────────────────────────────

#[test]
fn test_missing_labels_are_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.labels.remove("ploydok.app_id");

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("required_labels"),
        "message doit mentionner required_labels: {}",
        err.message()
    );
}

// ─── Test 6: network host ─────────────────────────────────────────────────────

#[test]
fn test_network_host_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.network = "host".to_string();

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("network_host_forbidden"),
        "message doit mentionner network_host_forbidden: {}",
        err.message()
    );
}

// ─── Test 7: user root ────────────────────────────────────────────────────────

#[test]
fn test_user_root_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.user = "root".to_string();

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("user_root_forbidden"),
        "message doit mentionner user_root_forbidden: {}",
        err.message()
    );
}

// ─── Test 8: cpu > 4 ──────────────────────────────────────────────────────────

#[test]
fn test_resource_cpu_over_limit_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.resource_limits = Some(ResourceLimits {
        cpu: 8.0,
        memory_bytes: 0,
        pids_limit: 0,
    });

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("resource_cpu_limit"),
        "message doit mentionner resource_cpu_limit: {}",
        err.message()
    );
}

// ─── Test 9: image build tag sans ploydok- ────────────────────────────────────

#[test]
fn test_image_build_tag_without_prefix_is_denied() {
    let v = make_validator();
    let req = ImageBuildRequest {
        tag: "myapp:latest".to_string(),
        dockerfile: b"FROM scratch".to_vec(),
        context: Default::default(),
        build_args: Default::default(),
    };

    let err = v.validate_image_build(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("image_build_tag_prefix"),
        "message doit mentionner image_build_tag_prefix: {}",
        err.message()
    );
}

// ─── Test 10: network create driver macvlan ───────────────────────────────────

#[test]
fn test_network_create_macvlan_is_denied() {
    let v = make_validator();
    let req = NetworkCreateRequest {
        name: "ploydok-net-macvlan".to_string(),
        driver: "macvlan".to_string(),
        labels: Default::default(),
    };

    let err = v.validate_network_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(
        err.message().contains("network_driver_forbidden"),
        "message doit mentionner network_driver_forbidden: {}",
        err.message()
    );
}

#[test]
fn test_invalid_healthcheck_mode_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.healthcheck = Some(HealthcheckConfig {
        test: vec!["RUN".to_string(), "echo ok".to_string()],
        interval_seconds: 5,
        timeout_seconds: 5,
        retries: 3,
        start_period_seconds: 0,
    });

    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(
        err.message().contains("healthcheck_mode_invalid"),
        "message doit mentionner healthcheck_mode_invalid: {}",
        err.message()
    );
}

// ─── Tests complémentaires : cas valides passent ──────────────────────────────

#[test]
fn test_valid_container_create_passes() {
    let v = make_validator();
    let mut req = valid_create();
    req.volumes = vec![VolumeMount {
        host_path: "/var/lib/ploydok/volumes/myapp/data".to_string(),
        container_path: "/data".to_string(),
        read_only: false,
    }];
    req.resource_limits = Some(ResourceLimits {
        cpu: 2.0,
        memory_bytes: 512 * 1024 * 1024, // 512 MiB
        pids_limit: 0,
    });
    assert!(v.validate_container_create(&req).is_ok());
}

#[test]
fn test_valid_image_pull_passes() {
    let v = make_validator();
    let req = ImagePullRequest {
        image: "ghcr.io/myorg/myimage:latest".to_string(),
        registry_auth: None,
    };
    assert!(v.validate_image_pull(&req).is_ok());
}

#[test]
fn test_valid_image_build_passes() {
    let v = make_validator();
    let req = ImageBuildRequest {
        tag: "ploydok-myapp:1.0".to_string(),
        dockerfile: b"FROM scratch".to_vec(),
        context: Default::default(),
        build_args: Default::default(),
    };
    assert!(v.validate_image_build(&req).is_ok());
}

#[test]
fn test_valid_network_create_bridge_passes() {
    let v = make_validator();
    let req = NetworkCreateRequest {
        name: "ploydok-app-net".to_string(),
        driver: "bridge".to_string(),
        labels: Default::default(),
    };
    assert!(v.validate_network_create(&req).is_ok());
}

#[test]
fn test_image_pull_evil_registry_denied() {
    let v = make_validator();
    let req = ImagePullRequest {
        image: "attacker.io/payload:latest".to_string(),
        registry_auth: None,
    };
    let err = v.validate_image_pull(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
}

#[test]
fn test_network_create_host_driver_denied() {
    let v = make_validator();
    let req = NetworkCreateRequest {
        name: "ploydok-hostnet".to_string(),
        driver: "host".to_string(),
        labels: Default::default(),
    };
    let err = v.validate_network_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(err.message().contains("network_driver_forbidden"));
}

#[test]
fn test_user_uid_zero_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.user = "0".to_string();
    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
}

#[test]
fn test_memory_over_limit_is_denied() {
    let v = make_validator();
    let mut req = valid_create();
    req.resource_limits = Some(ResourceLimits {
        cpu: 1.0,
        memory_bytes: 16 * 1024 * 1024 * 1024, // 16 GiB
        pids_limit: 0,
    });
    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::InvalidArgument);
    assert!(err.message().contains("resource_memory_limit"));
}

// ─── Sprint-3bis: multi-network support ──────────────────────────────────────

#[test]
fn test_multi_networks_ploydok_prefix_ok() {
    let v = make_validator();
    let mut req = valid_create();
    req.network = String::new();
    req.networks = vec![
        "ploydok-proj-abc".to_string(),
        "ploydok-ingress".to_string(),
    ];
    assert!(v.validate_container_create(&req).is_ok());
}

#[test]
fn test_multi_networks_rejects_host() {
    let v = make_validator();
    let mut req = valid_create();
    req.network = String::new();
    req.networks = vec!["ploydok-proj-abc".to_string(), "host".to_string()];
    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(err.message().contains("network_host_forbidden"));
}

#[test]
fn test_multi_networks_rejects_bad_prefix() {
    let v = make_validator();
    let mut req = valid_create();
    req.network = String::new();
    req.networks = vec!["evil-net".to_string()];
    let err = v.validate_container_create(&req).unwrap_err();
    assert_eq!(err.code(), Code::PermissionDenied);
    assert!(err.message().contains("network_prefix"));
}
