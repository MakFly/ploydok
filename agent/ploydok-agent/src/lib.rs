// SPDX-License-Identifier: AGPL-3.0-only
//
// Library entry point — exposes internal modules for integration tests.

pub mod audit;
pub mod host_stats;
pub mod pki;
pub mod service;
pub mod validator;

// Monitor is declared inside service (as #[path = "monitor.rs"] pub mod monitor).
// Re-export here for convenience (e.g. integration tests).
pub use service::monitor;
