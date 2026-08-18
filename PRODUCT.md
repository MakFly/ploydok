# Ploydok product context

## Register

product

## Users

Ploydok serves developers and small infrastructure teams operating a self-hosted
PaaS on a VPS. They sign in to connect a Git provider, import a repository,
deploy it, and operate the resulting services without introducing Kubernetes.

## Product Purpose

Ploydok turns Git repositories and container images into observable Docker
Swarm workloads. The product should make the critical path from authentication
to a first deploy explicit, safe, and fast, while keeping platform-wide setup
separate from each user's provider connection.

## Brand Personality

Precise, assured, and quietly distinctive. The interface should feel like a
serious operations tool with careful editorial composition, not a generic SaaS
template.

## Anti-references

- Generic centered authentication cards floating on an empty background.
- Decorative gradients, glass panels, or motion that compete with the task.
- Infrastructure interfaces that expose internal configuration concepts before
  telling the user what action is required.
- Provider setup flows that blur instance-admin configuration and per-user
  authorization.

## Design Principles

1. Lead users through the real deployment prerequisite chain.
2. Separate platform administration from personal authorization.
3. Use visual confidence and whitespace to reduce operational anxiety.
4. Keep familiar controls familiar, then place personality in composition and
   supporting artwork.
5. Explain blocked states with one concrete next action.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, keyboard access, labels, focus visibility, and
error announcements. Respect reduced-motion preferences and keep the complete
authentication flow usable on narrow touch screens.

## Feature maturity

Ploydok uses exactly three public maturity levels. `Stable` means the feature
is reachable and covered by production-path release tests. `Beta` means it is
reachable with a documented limitation or incomplete release evidence.
`Planned` capabilities are not presented as generally available.

| Capability                                                              | Maturity | Current limitation                                           |
| ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| GitHub application deploys                                              | Beta     | Mandatory release E2E still required                         |
| OCI image deploys                                                       | Beta     | Fresh-onboarding E2E still required                          |
| GitLab deploys                                                          | Beta     | Browser creation journey is not yet release-certified        |
| Domains, logs, shell, environment and storage                           | Beta     | Production isolation journey still requires release proof    |
| Managed databases and rollback                                          | Beta     | Restore and migration rollback evidence remains required     |
| Preview deployments                                                     | Beta     | Pull-request lifecycle coverage is incomplete                |
| Shared environment, scheduled jobs, event webhooks, API tokens and tags | Planned  | Backend/UI maturity varies; not part of the stable milestone |
| Compose application deployment                                          | Planned  | No supported runtime contract yet                            |
| Multi-node Swarm                                                        | Planned  | First release is explicitly single-node                      |
