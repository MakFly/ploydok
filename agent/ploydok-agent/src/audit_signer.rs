// SPDX-License-Identifier: AGPL-3.0-only
//
// Audit-log Ed25519 signer. Key persists in $PLOYDOK_AUDIT_KEY_DIR
// (default: /var/lib/ploydok/keys in prod, $HOME/.ploydok-dev/keys in dev).
// File audit-ed25519.key contains 32 bytes raw secret + "\n# kid=<id>\n".
// Permissions enforced 0o400 (read-only after creation).

use anyhow::{Context, Result};
use ed25519_dalek::{Signature, Signer, SigningKey};
use rand_core::OsRng;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::Arc;
use zeroize::Zeroize;

pub struct AuditSigner {
    signing_key: SigningKey,
    key_id: String,
}

impl AuditSigner {
    /// Bootstrap the audit signer. If the key file exists, load it.
    /// Otherwise, generate a new key and persist it.
    pub fn bootstrap(dir: &Path) -> Result<Arc<Self>> {
        fs::create_dir_all(dir).context("create key dir")?;
        let key_path = dir.join("audit-ed25519.key");
        if key_path.exists() {
            Self::load(&key_path)
        } else {
            Self::generate_and_persist(&key_path)
        }
    }

    /// Generate a new Ed25519 key and persist it to disk.
    fn generate_and_persist(path: &Path) -> Result<Arc<Self>> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let key_id = format!("kid-{}", rand_short_id());

        // Build file content: 32 raw secret bytes + trailer
        let mut content = signing_key.to_bytes().to_vec();
        let header = format!("\n# kid={}\n", key_id);
        content.extend_from_slice(header.as_bytes());

        // Create file with mode 0o600 to allow initial write
        let mut f = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .context("create key file")?;

        f.write_all(&content).context("write key file")?;
        f.sync_all().context("sync key file")?;
        drop(f);

        // Chmod to 0o400 (read-only) after successful write
        fs::set_permissions(path, fs::Permissions::from_mode(0o400))
            .context("chmod key file to 0o400")?;

        content.zeroize();

        Ok(Arc::new(Self {
            signing_key,
            key_id,
        }))
    }

    /// Load an existing Ed25519 key from disk.
    fn load(path: &Path) -> Result<Arc<Self>> {
        let mut content = fs::read(path).context("read key file")?;

        if content.len() < 32 {
            anyhow::bail!(
                "key file too short (expected ≥ 32 bytes, got {})",
                content.len()
            );
        }

        let secret: [u8; 32] = content[..32].try_into().expect("slice is exactly 32 bytes");
        let signing_key = SigningKey::from_bytes(&secret);

        // Parse the trailer to extract kid
        let kid_str = std::str::from_utf8(&content[32..]).unwrap_or("");
        let key_id = kid_str
            .lines()
            .find_map(|l| l.strip_prefix("# kid=").map(|s| s.trim().to_string()))
            .context("kid trailer missing from key file")?;

        content.zeroize();

        Ok(Arc::new(Self {
            signing_key,
            key_id,
        }))
    }

    /// Sign a payload and return the signature + key id.
    pub fn sign(&self, payload: &[u8]) -> (Signature, String) {
        (self.signing_key.sign(payload), self.key_id.clone())
    }

    /// Get the public key bytes and key id.
    pub fn pubkey(&self) -> (Vec<u8>, String) {
        (
            self.signing_key.verifying_key().to_bytes().to_vec(),
            self.key_id.clone(),
        )
    }
}

/// Generate a short random hex id for kid.
fn rand_short_id() -> String {
    use rand_core::RngCore;
    let mut buf = [0u8; 4];
    OsRng.fill_bytes(&mut buf);
    format!("{:08x}", u32::from_le_bytes(buf))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_bootstrap_generate_and_persist() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("audit-ed25519.key");

        // First bootstrap should generate
        let signer1 = AuditSigner::bootstrap(dir.path()).unwrap();
        assert!(key_path.exists());

        // Check permissions are 0o400
        let perms = fs::metadata(&key_path).unwrap().permissions();
        assert_eq!(perms.mode() & 0o777, 0o400, "file should be 0o400");

        // Second bootstrap should load the same key
        let signer2 = AuditSigner::bootstrap(dir.path()).unwrap();
        assert_eq!(
            signer1.key_id, signer2.key_id,
            "reloaded key should have same kid"
        );

        // Verify the file format: 32 bytes + trailer
        let content = fs::read(&key_path).unwrap();
        assert!(
            content.len() > 32,
            "file should have content beyond 32 bytes"
        );
        assert!(
            String::from_utf8_lossy(&content[32..]).contains("# kid="),
            "trailer should contain kid marker"
        );
    }

    #[test]
    fn test_sign_and_verify_roundtrip() {
        let dir = TempDir::new().unwrap();
        let signer = AuditSigner::bootstrap(dir.path()).unwrap();

        let payload = b"test audit entry payload";
        let (signature, kid) = signer.sign(payload);

        // Verify signature using the public key
        let (pubkey_bytes, _) = signer.pubkey();
        let verifying_key =
            VerifyingKey::from_bytes(&pubkey_bytes[..].try_into().expect("pubkey is 32 bytes"))
                .expect("valid public key");

        // Signature should verify
        assert!(
            verifying_key.verify(payload, &signature).is_ok(),
            "signature should verify against public key"
        );

        // Signature should not verify with wrong payload
        let wrong_payload = b"different payload";
        assert!(
            verifying_key.verify(wrong_payload, &signature).is_err(),
            "signature should not verify with wrong payload"
        );

        // Kid should be non-empty and match what we returned
        assert!(!kid.is_empty());
        assert!(kid.starts_with("kid-"));
    }

    #[test]
    fn test_load_persisted_key() {
        let dir = TempDir::new().unwrap();

        // Generate and persist
        let signer1 = AuditSigner::bootstrap(dir.path()).unwrap();
        let payload = b"test data";
        let (sig1, kid1) = signer1.sign(payload);
        let (pubkey1, _) = signer1.pubkey();

        // Load the same key from disk
        let signer2 = AuditSigner::bootstrap(dir.path()).unwrap();
        let (pubkey2, kid2) = signer2.pubkey();

        // Public keys should match
        assert_eq!(pubkey1, pubkey2, "loaded key should match original");
        assert_eq!(kid1, kid2, "loaded kid should match original");

        // Both signers should produce signatures that verify the same
        let (sig2, _) = signer2.sign(payload);
        let verifying_key =
            VerifyingKey::from_bytes(&pubkey2[..].try_into().expect("pubkey is 32 bytes"))
                .expect("valid public key");

        assert!(
            verifying_key.verify(payload, &sig1).is_ok(),
            "original signature should verify"
        );
        assert!(
            verifying_key.verify(payload, &sig2).is_ok(),
            "new signature should verify"
        );
    }
}
