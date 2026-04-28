// SPDX-License-Identifier: AGPL-3.0-only
use anyhow::{anyhow, bail, Context, Result};
use base64ct::{Base64UrlUnpadded, Encoding};
use chrono::{DateTime, Utc};
use ed25519_zebra::VerificationKey;
use postgres::Client;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
struct AuditEntry {
    id: i32,
    user_id: Option<String>,
    action: String,
    target_type: String,
    target_id: String,
    metadata: String,
    created_at: DateTime<Utc>,
    prev_hash: Option<String>,
    hash: Option<String>,
    signature: Option<String>,
    #[allow(dead_code)]
    key_id: Option<String>,
}

#[derive(Debug, Clone)]
struct AuditAnchor {
    id: i32,
    head_audit_id: i32,
    head_hash: String,
    #[allow(dead_code)]
    signature: String,
    #[allow(dead_code)]
    key_id: String,
    #[allow(dead_code)]
    signed_at: DateTime<Utc>,
}

pub struct Config {
    pub db_url: String,
    pub pubkey_bytes: Option<Vec<u8>>,
    pub pubkey_file: Option<String>,
}

#[allow(dead_code)]
fn build_canonical_payload(entry: &AuditEntry) -> Vec<u8> {
    let metadata_hash = Sha256::digest(entry.metadata.as_bytes());
    let metadata_hex = hex::encode(metadata_hash);

    let user_id_str = entry.user_id.as_deref().unwrap_or("->");
    let prev_hash_str = entry.prev_hash.as_deref().unwrap_or("->");
    let hash_str = entry.hash.as_deref().unwrap_or("->");

    let iso_str = entry
        .created_at
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let lines = [
        "v1",
        &entry.id.to_string(),
        &iso_str,
        user_id_str,
        &entry.action,
        &entry.target_type,
        &entry.target_id,
        &metadata_hex,
        prev_hash_str,
        hash_str,
    ];

    lines.join("\n").into_bytes()
}

fn compute_hash(prev_hash: Option<&str>, canonical: &str) -> String {
    let bytes = if let Some(prev) = prev_hash {
        format!("{}{}", prev, canonical).into_bytes()
    } else {
        canonical.as_bytes().to_vec()
    };

    hex::encode(Sha256::digest(&bytes))
}

fn load_pubkey(config: &Config) -> Result<Vec<u8>> {
    if let Some(ref bytes_opt) = config.pubkey_bytes {
        return Ok(bytes_opt.clone());
    }

    if let Some(ref path_str) = config.pubkey_file {
        let content = std::fs::read_to_string(path_str)
            .with_context(|| format!("reading pubkey file {}", path_str))?;

        // Try PEM format first (-----BEGIN PUBLIC KEY-----)
        if content.contains("-----BEGIN PUBLIC KEY-----") {
            let pem_body = content
                .lines()
                .filter(|line| !line.starts_with("-----"))
                .collect::<String>();

            if let Ok(decoded) = Base64UrlUnpadded::decode_vec(&pem_body) {
                if decoded.len() == 32 {
                    return Ok(decoded);
                }
                // DER-encoded, extract the 32-byte public key
                if decoded.len() > 32 {
                    return Ok(decoded[decoded.len() - 32..].to_vec());
                }
            }
        }

        // Try hex format
        if let Ok(decoded) = hex::decode(content.trim()) {
            if decoded.len() == 32 {
                return Ok(decoded);
            }
        }

        // Try base64
        if let Ok(decoded) = Base64UrlUnpadded::decode_vec(content.trim()) {
            if decoded.len() == 32 {
                return Ok(decoded);
            }
        }

        bail!(
            "pubkey file must be 32-byte hex, base64, or PEM format, got {} bytes",
            content.len()
        );
    }

    bail!("no pubkey provided (use --pubkey or --pubkey-file)");
}

pub fn run(config: Config) -> Result<u8> {
    let pubkey_bytes = load_pubkey(&config)?;
    if pubkey_bytes.len() != 32 {
        bail!(
            "invalid pubkey length: expected 32 bytes, got {}",
            pubkey_bytes.len()
        );
    }
    let pubkey_array = <[u8; 32]>::try_from(pubkey_bytes.as_slice())?;
    let verification_key =
        VerificationKey::try_from(pubkey_array).map_err(|_| anyhow!("invalid ed25519 pubkey"))?;

    let mut client =
        Client::connect(&config.db_url, postgres::NoTls).context("connecting to database")?;

    // 1. Read all audit entries ordered by id
    let rows = client
        .query(
            "SELECT id, user_id, action, target_type, target_id, metadata, \
             created_at, prev_hash, hash, signature, key_id \
             FROM audit_log ORDER BY id ASC",
            &[],
        )
        .context("querying audit_log")?;

    let mut entries = Vec::new();
    for row in rows {
        let created_at_str: String = row.get(6);
        let created_at = DateTime::parse_from_rfc3339(&created_at_str)
            .context("parsing created_at timestamp")?
            .with_timezone(&Utc);

        entries.push(AuditEntry {
            id: row.get(0),
            user_id: row.get(1),
            action: row.get(2),
            target_type: row.get(3),
            target_id: row.get(4),
            metadata: row.get(5),
            created_at,
            prev_hash: row.get(7),
            hash: row.get(8),
            signature: row.get(9),
            key_id: row.get(10),
        });
    }

    // 2. Read all anchors ordered by id
    let anchor_rows = client
        .query(
            "SELECT id, head_audit_id, head_hash, signature, key_id, signed_at \
             FROM audit_anchors ORDER BY id ASC",
            &[],
        )
        .context("querying audit_anchors")?;

    let mut anchors = Vec::new();
    for row in anchor_rows {
        let signed_at_str: String = row.get(5);
        let signed_at = DateTime::parse_from_rfc3339(&signed_at_str)
            .context("parsing signed_at timestamp")?
            .with_timezone(&Utc);

        anchors.push(AuditAnchor {
            id: row.get(0),
            head_audit_id: row.get(1),
            head_hash: row.get(2),
            signature: row.get(3),
            key_id: row.get(4),
            signed_at,
        });
    }

    // 3. Verify hash chain and signatures
    let mut has_unsigned = false;
    let mut has_tampered = false;
    let mut tamper_location = None;

    for (idx, entry) in entries.iter().enumerate() {
        let is_signed = entry.signature.is_some();
        if !is_signed {
            has_unsigned = true;
            println!("⚠ Entry {} (id={}) is unsigned", idx, entry.id);
            continue;
        }

        // Rebuild canonical without the hash field
        let canonical = {
            let metadata_hash = Sha256::digest(entry.metadata.as_bytes());
            let metadata_hex = hex::encode(metadata_hash);

            let user_id_str = entry.user_id.as_deref().unwrap_or("->");
            let prev_hash_str = entry.prev_hash.as_deref().unwrap_or("->");

            let iso_str = entry
                .created_at
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

            let lines = [
                "v1",
                &entry.id.to_string(),
                &iso_str,
                user_id_str,
                &entry.action,
                &entry.target_type,
                &entry.target_id,
                &metadata_hex,
                prev_hash_str,
                entry.hash.as_deref().unwrap_or("->"),
            ];

            lines.join("\n")
        };

        // Verify signature
        if let Some(ref sig_str) = entry.signature {
            match Base64UrlUnpadded::decode_vec(sig_str) {
                Ok(sig_bytes) => {
                    if sig_bytes.len() != 64 {
                        has_tampered = true;
                        if tamper_location.is_none() {
                            tamper_location = Some((entry.id, "invalid signature length"));
                        }
                        println!(
                            "✗ Entry {} (id={}): TAMPERED (bad signature length)",
                            idx, entry.id
                        );
                        continue;
                    }

                    let sig_array =
                        <[u8; 64]>::try_from(&sig_bytes[..]).map_err(|_| anyhow!("unreachable"))?;
                    let sig = ed25519_zebra::Signature::from(sig_array);

                    match verification_key.verify(&sig, canonical.as_bytes()) {
                        Ok(_) => {
                            println!("✓ Entry {} (id={}) verified", idx, entry.id);
                        }
                        Err(_) => {
                            has_tampered = true;
                            if tamper_location.is_none() {
                                tamper_location = Some((entry.id, "signature verification failed"));
                            }
                            println!(
                                "✗ Entry {} (id={}): TAMPERED (signature verification failed)",
                                idx, entry.id
                            );
                        }
                    }
                }
                Err(_) => {
                    has_tampered = true;
                    if tamper_location.is_none() {
                        tamper_location = Some((entry.id, "invalid base64url signature"));
                    }
                    println!(
                        "✗ Entry {} (id={}): TAMPERED (invalid base64url signature)",
                        idx, entry.id
                    );
                }
            }
        }

        // Verify hash chain
        let expected_hash = compute_hash(entry.prev_hash.as_deref(), &canonical);
        if let Some(ref stored_hash) = entry.hash {
            if stored_hash != &expected_hash {
                has_tampered = true;
                if tamper_location.is_none() {
                    tamper_location = Some((entry.id, "hash chain broken"));
                }
                println!(
                    "✗ Entry {} (id={}): TAMPERED (hash mismatch: expected {}, got {})",
                    idx, entry.id, expected_hash, stored_hash
                );
            }
        }
    }

    // 4. Verify anchors
    if !anchors.is_empty() {
        for (anchor_idx, anchor) in anchors.iter().enumerate() {
            // Find the entry this anchor points to
            if let Some(entry) = entries.iter().find(|e| e.id == anchor.head_audit_id) {
                if entry.hash.as_deref() != Some(&anchor.head_hash) {
                    has_tampered = true;
                    if tamper_location.is_none() {
                        tamper_location = Some((anchor.head_audit_id, "anchor drift"));
                    }
                    println!(
                        "✗ Anchor {} (id={}): ANCHOR DRIFT (head_hash mismatch)",
                        anchor_idx, anchor.id
                    );
                }
            } else {
                has_tampered = true;
                if tamper_location.is_none() {
                    tamper_location =
                        Some((anchor.head_audit_id, "anchor points to missing entry"));
                }
                println!(
                    "✗ Anchor {} (id={}): ANCHOR DRIFT (missing entry {})",
                    anchor_idx, anchor.id, anchor.head_audit_id
                );
            }
        }
    }

    // 5. Determine exit code
    if has_tampered {
        if let Some((id, reason)) = tamper_location {
            eprintln!("Tampering detected at entry id={}: {}", id, reason);
        }
        return Ok(2);
    }

    if has_unsigned {
        println!("⚠ Chain contains unsigned entries (legacy)");
        return Ok(1);
    }

    println!("✓ Audit log integrity verified");
    Ok(0)
}
