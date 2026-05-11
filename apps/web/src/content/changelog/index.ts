// SPDX-License-Identifier: AGPL-3.0-only
import frameworkGuardrails from "./2026-05-11-framework-guardrails.md?raw"
import monitoringDashboard from "./2026-05-11-monitoring-dashboard.md?raw"
import swarmRollouts from "./2026-05-11-swarm-rollouts.md?raw"

export interface ChangelogEntry {
  version: string
  date: string
  title: string
  summary: string
  tags: Array<string>
  body: string
}

export const changelogEntries: Array<ChangelogEntry> = [
  {
    version: "2026.05.11",
    date: "2026-05-11",
    title: "Dashboard monitoring workspace",
    summary:
      "Le dashboard remonte les services runtime du workspace courant au lieu d'afficher des compteurs Docker bruts.",
    tags: ["Monitoring", "Dashboard", "Workspace"],
    body: monitoringDashboard,
  },
  {
    version: "2026.05.11",
    date: "2026-05-11",
    title: "Framework guardrails génériques",
    summary:
      "Détection enrichie par manifests, réparation des env cassants, et garde-fous Laravel/Symfony/PHP/Next/Hono/Python/Rails/Phoenix.",
    tags: ["Frameworks", "Deploy safety", "Env"],
    body: frameworkGuardrails,
  },
  {
    version: "2026.05.10",
    date: "2026-05-10",
    title: "Runtime Swarm, scaling et rollouts propres",
    summary:
      "Scaling par replicas, update start-first, rollout CI/CD propre, cleanup images et resync runtime monitoring.",
    tags: ["Swarm", "Scaling", "CI/CD"],
    body: swarmRollouts,
  },
]
