// SPDX-License-Identifier: AGPL-3.0-only
use std::path::PathBuf;

use anyhow::Result;
use base64ct::{Base64UrlUnpadded, Encoding};
use clap::{Parser, Subcommand};

use ploydok_cli::recovery::AllowNonRoot;

#[derive(Parser)]
#[command(
    name = "ploydok-cli",
    version,
    about = "Ploydok administration CLI",
    long_about = None
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Emergency admin recovery — resets the first user's recovery token
    /// and revokes all active sessions.
    ///
    /// Must be run as root (or with --allow-non-root for testing).
    AdminRecovery {
        /// Path to the SQLite database file.
        /// Falls back to the PLOYDOK_DB_PATH env-var, then the default location.
        #[arg(
            long,
            env = "PLOYDOK_DB_PATH",
            default_value = "/var/lib/ploydok/ploydok.db"
        )]
        db: PathBuf,

        /// Skip the root uid check (for tests / CI only).
        /// A prominent warning is printed to stderr when this flag is used.
        #[arg(long, hide = true)]
        allow_non_root: bool,
    },

    /// Verify audit log integrity (hash chain and Ed25519 signatures).
    Audit {
        #[command(subcommand)]
        subcommand: AuditCommands,
    },
}

#[derive(Subcommand)]
enum AuditCommands {
    /// Verify audit log chain integrity and signature validity.
    ///
    /// Reads the Postgres database and verifies:
    /// - Hash chain continuity
    /// - Ed25519 signature validity (if signatures present)
    /// - Anchor integrity
    ///
    /// Exit codes:
    ///   0 — OK (all entries signed and valid)
    ///   1 — Legacy entries found (unsigned audit log)
    ///   2 — Tampering detected (chain break or bad signature)
    ///   3 — Anchor drift detected
    ///   4 — IO/DB error
    Verify {
        /// Postgres connection string (postgres://user:pass@host:port/dbname).
        /// Falls back to DATABASE_URL env-var.
        #[arg(long, env = "DATABASE_URL")]
        db_url: String,

        /// Path to public key file (PEM or raw 32-byte hex/base64).
        /// If neither --pubkey nor --pubkey-file is provided, verification is skipped.
        #[arg(long)]
        pubkey_file: Option<String>,

        /// Base64URL-encoded public key (32 bytes).
        #[arg(long)]
        pubkey: Option<String>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::AdminRecovery { db, allow_non_root } => {
            let guard = if allow_non_root {
                AllowNonRoot::Yes
            } else {
                AllowNonRoot::No
            };
            ploydok_cli::recovery::run(&db, guard)?;
        }
        Commands::Audit { subcommand } => match subcommand {
            AuditCommands::Verify {
                db_url,
                pubkey_file,
                pubkey,
            } => {
                let pubkey_bytes = if let Some(pubkey_str) = pubkey {
                    Some(
                        Base64UrlUnpadded::decode_vec(&pubkey_str)
                            .map_err(|_| anyhow::anyhow!("invalid base64url pubkey"))?,
                    )
                } else {
                    None
                };

                let config = ploydok_cli::audit_verify::Config {
                    db_url,
                    pubkey_bytes,
                    pubkey_file,
                };

                let exit_code = ploydok_cli::audit_verify::run(config)?;
                std::process::exit(exit_code as i32);
            }
        },
    }

    Ok(())
}
