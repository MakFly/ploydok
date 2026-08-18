# Security Policy

## Supported versions

Ploydok is pre-release (< 1.0). Security fixes are developed on `main` until
the first supported release line is published. Pre-release builds do not carry
a production support guarantee.

## Reporting a vulnerability

**Do not open a public issue** for security vulnerabilities.

Email: `security@ploydok.dev`

Encrypted email is not available yet. Do not include production secrets,
credentials or personal data in the initial report. We will establish an
appropriate secure exchange channel during triage when needed.

### What to include

- Description of the vulnerability and affected component
- Reproduction steps (minimal PoC preferred)
- Impact assessment
- Your disclosure timeline expectations

### Our commitments

- Acknowledgement within **72 hours**
- Triage and severity assessment within **7 days**
- Fix timeline communicated after triage (depending on severity)
- Credit in advisory if desired

## Scope

**In scope**
- Ploydok source code (this repository)
- Official Docker images and install scripts published by the project
- Official CLI and agent binaries

**Out of scope**
- User deployments or self-hosted instances misconfigured by operators
- Third-party dependencies (report upstream first, copy us)
- Social engineering, physical attacks, DoS
- Issues requiring root on the host to exploit

## Agent PKI operations

Production API-to-agent traffic uses mutual TLS. The CA is valid for ten years;
the agent and API client certificates are valid for one year and must be
rotated before the 30-day warning threshold. Runtime containers receive only
the files they require: the API gets the CA certificate and client identity,
the agent gets the CA certificate and server identity, and neither receives
the CA private key.

Operators can check expiry without changing state:

```bash
sudo ploydok-cli check-agent-pki --warn-days=30
```

Rotate the CA and both leaf identities after suspected key exposure, operator
turnover, or an expiry warning:

```bash
sudo ploydok-cli rotate-agent-pki --yes
```

Rotation keeps a mode-0600 recovery archive under
`/var/lib/ploydok/backups`, restarts the agent and API, and succeeds only when
the authenticated readiness check recovers. Copy recovery archives to the
encrypted off-host backup target, then remove superseded copies according to
that target's retention policy.

## Dependency vulnerability policy

JavaScript advisories are evaluated by `bun run audit:dependencies`. Every
critical or high advisory must either be removed or have a current entry in
`security/advisory-triage.json` identifying whether it is reachable at runtime,
build time or only in tests. The gate rejects undocumented advisories, stale
entries, expired reviews and any accepted exploitable critical runtime issue.

Rust dependencies are checked with the pinned `cargo-audit` release in CI.
Released container images are scanned before promotion and include an SBOM and
provenance attestation. A failed dependency or image gate prevents stable
promotion; it is not converted into a documentation-only exception.
