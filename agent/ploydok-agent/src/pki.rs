// SPDX-License-Identifier: AGPL-3.0-only
//
// PKI bootstrap — generates CA + server + client certificates at first boot.
//
// Structure:
//   <pki_dir>/
//     ca.pem, ca.key
//     server.pem, server.key
//     client.pem, client.key
//
// If the directory is absent or empty, all certs are generated automatically.
// To force regeneration, delete the PKI directory and restart the agent.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use anyhow::{Context, Result};
use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, SanType};
use sha2::{Digest, Sha256};
use tracing::{info, warn};
use x509_parser::pem::parse_x509_pem;
use x509_parser::prelude::FromDer;

/// Loaded TLS material for a tonic `ServerTlsConfig`.
pub struct PkiMaterial {
    pub server_cert_pem: Vec<u8>,
    pub server_key_pem: Vec<u8>,
    pub ca_cert_pem: Vec<u8>,
}

/// Ensure the PKI directory exists and all cert files are present.
///
/// Generates them if the directory is absent or does not contain all expected files.
/// Returns the loaded PEM bytes for the server cert, server key and CA cert.
pub fn ensure_pki(pki_dir: &str) -> Result<PkiMaterial> {
    let dir = Path::new(pki_dir);
    let files = [
        "ca.pem",
        "ca.key",
        "server.pem",
        "server.key",
        "client.pem",
        "client.key",
    ];

    let needs_gen = !dir.exists() || files.iter().any(|f| !dir.join(f).exists());

    if needs_gen {
        info!(pki_dir = pki_dir, "Génération des certificats PKI...");
        std::fs::create_dir_all(dir)
            .with_context(|| format!("Impossible de créer le répertoire PKI: {pki_dir}"))?;
        generate_pki(dir)?;
        info!(pki_dir = pki_dir, "Certificats PKI générés avec succès");
    } else {
        info!(pki_dir = pki_dir, "Certificats PKI existants chargés");
    }

    let ca_cert_pem = std::fs::read(dir.join("ca.pem"))
        .with_context(|| format!("Lecture de {pki_dir}/ca.pem"))?;
    let server_cert_pem = std::fs::read(dir.join("server.pem"))
        .with_context(|| format!("Lecture de {pki_dir}/server.pem"))?;
    let server_key_pem = std::fs::read(dir.join("server.key"))
        .with_context(|| format!("Lecture de {pki_dir}/server.key"))?;

    // Log fingerprints.
    log_fingerprint("CA cert", &ca_cert_pem);
    log_fingerprint("Server cert", &server_cert_pem);

    // Refuse to boot with an expired server cert; warn loudly when expiry
    // is imminent so operators can rotate before clients start failing.
    assert_cert_not_expired("Server cert", &server_cert_pem, SystemTime::now())?;
    assert_cert_not_expired("CA cert", &ca_cert_pem, SystemTime::now())?;

    Ok(PkiMaterial {
        server_cert_pem,
        server_key_pem,
        ca_cert_pem,
    })
}

/// Number of seconds below which we still accept the certificate but log a
/// loud warning so operators rotate before things break.
const EXPIRY_WARN_SECONDS: i64 = 30 * 24 * 60 * 60; // 30 days

/// Parse a PEM-encoded X.509 certificate and refuse to start if it has
/// already expired according to `now`. Logs a warning when the certificate
/// is within [`EXPIRY_WARN_SECONDS`] of expiry.
///
/// `now` is parameterised so tests can inject a deterministic clock.
pub fn assert_cert_not_expired(label: &str, pem: &[u8], now: SystemTime) -> Result<()> {
    let (_, pem) = parse_x509_pem(pem).with_context(|| format!("{label}: PEM parse failed"))?;
    let (_, cert) = x509_parser::certificate::X509Certificate::from_der(&pem.contents)
        .with_context(|| format!("{label}: DER parse failed"))?;

    let not_after = cert.validity().not_after.timestamp();
    let now_unix = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    if not_after <= now_unix {
        anyhow::bail!("{label}: certificate has expired (not_after={not_after}, now={now_unix})");
    }

    if not_after - now_unix < EXPIRY_WARN_SECONDS {
        let days_left = (not_after - now_unix) / (24 * 60 * 60);
        warn!(
            label = label,
            days_left = days_left,
            not_after = not_after,
            "Certificat proche de l'expiration — prévoir une rotation"
        );
    }
    Ok(())
}

/// Generate CA, server and client certificates and write PEM files to `dir`.
fn generate_pki(dir: &Path) -> Result<()> {
    // ── CA ────────────────────────────────────────────────────────────────────
    let ca_key = KeyPair::generate()?;

    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(DnType::CommonName, "Ploydok Root CA");
    ca_params
        .distinguished_name
        .push(DnType::OrganizationName, "Ploydok");
    // 10 year validity
    ca_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    ca_params.not_after = rcgen::date_time_ymd(2034, 1, 1);

    let ca_cert = ca_params.self_signed(&ca_key)?;

    write_pem(dir.join("ca.pem"), ca_cert.pem())?;
    write_pem(dir.join("ca.key"), ca_key.serialize_pem())?;

    // ── Server cert ───────────────────────────────────────────────────────────
    let server_key = KeyPair::generate()?;
    let mut server_params = CertificateParams::default();
    server_params
        .distinguished_name
        .push(DnType::CommonName, "ploydok-agent");
    server_params.subject_alt_names = vec![
        SanType::DnsName("localhost".try_into()?),
        SanType::DnsName("ploydok-agent".try_into()?),
    ];
    server_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    server_params.not_after = rcgen::date_time_ymd(2034, 1, 1);

    let server_cert = server_params.signed_by(&server_key, &ca_cert, &ca_key)?;

    write_pem(dir.join("server.pem"), server_cert.pem())?;
    write_pem(dir.join("server.key"), server_key.serialize_pem())?;

    // ── Client cert ───────────────────────────────────────────────────────────
    let client_key = KeyPair::generate()?;
    let mut client_params = CertificateParams::default();
    client_params
        .distinguished_name
        .push(DnType::CommonName, "ploydok-api-client");
    client_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    client_params.not_after = rcgen::date_time_ymd(2034, 1, 1);

    let client_cert = client_params.signed_by(&client_key, &ca_cert, &ca_key)?;

    write_pem(dir.join("client.pem"), client_cert.pem())?;
    write_pem(dir.join("client.key"), client_key.serialize_pem())?;

    Ok(())
}

/// Write a PEM string to a file path.
fn write_pem(path: PathBuf, pem: String) -> Result<()> {
    std::fs::write(&path, pem).with_context(|| format!("Écriture de {}", path.display()))
}

/// Log the SHA256 fingerprint of a PEM certificate.
fn log_fingerprint(label: &str, pem: &[u8]) {
    // Extract the DER bytes from the PEM — look for the base64 body.
    let pem_str = String::from_utf8_lossy(pem);
    let der_bytes = extract_der_from_pem(&pem_str);
    let fingerprint = hex::encode(Sha256::digest(&der_bytes));
    // Format as colon-separated pairs for readability.
    let formatted: String = fingerprint
        .as_bytes()
        .chunks(2)
        .map(|c| std::str::from_utf8(c).unwrap_or("??"))
        .collect::<Vec<_>>()
        .join(":");
    info!(label = label, fingerprint = %formatted, "Certificat chargé");
}

/// Extract raw DER bytes from a PEM string (ignores header/footer, decodes base64).
fn extract_der_from_pem(pem: &str) -> Vec<u8> {
    let base64_body: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    let mut bytes = Vec::new();
    decode_base64(&base64_body, &mut bytes);
    bytes
}

/// Minimal base64 decoder (standard alphabet, ignores whitespace).
fn decode_base64(input: &str, out: &mut Vec<u8>) {
    const TABLE: &[u8; 128] = b"\
\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\
\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\
\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x80\x3e\x80\x80\x80\x3f\
\x34\x35\x36\x37\x38\x39\x3a\x3b\x3c\x3d\x80\x80\x80\x80\x80\x80\
\x80\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\
\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x80\x80\x80\x80\x80\
\x80\x1a\x1b\x1c\x1d\x1e\x1f\x20\x21\x22\x23\x24\x25\x26\x27\x28\
\x29\x2a\x2b\x2c\x2d\x2e\x2f\x30\x31\x32\x33\x80\x80\x80\x80\x80";

    let bytes: Vec<u8> = input
        .bytes()
        .filter(|&b| b != b'=' && (b as usize) < TABLE.len() && TABLE[b as usize] != 0x80)
        .map(|b| TABLE[b as usize])
        .collect();

    for chunk in bytes.chunks(4) {
        let len = chunk.len();
        if len < 2 {
            break;
        }
        let b0 = chunk[0];
        let b1 = chunk[1];
        out.push((b0 << 2) | (b1 >> 4));
        if len > 2 {
            let b2 = chunk[2];
            out.push((b1 << 4) | (b2 >> 2));
            if len > 3 {
                let b3 = chunk[3];
                out.push((b2 << 6) | b3);
            }
        }
    }
}
