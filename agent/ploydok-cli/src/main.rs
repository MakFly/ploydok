// SPDX-License-Identifier: AGPL-3.0-only
use std::path::PathBuf;

use anyhow::Result;
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
    }

    Ok(())
}
