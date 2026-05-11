// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiGitBranchLine,
  RiLoopLeftLine,
  RiScales3Line,
  RiSettings3Line,
} from "@remixicon/react"
import { ShellPage } from "../../components/layout/AppShell"
import { APP_VERSION } from "../../lib/hooks/use-unseen-release"

export const Route = createFileRoute("/_authed/changelog")({
  component: ChangelogPage,
})

function ChangelogPage(): React.JSX.Element {
  return (
    <ShellPage
      title="Changelog"
      description="Release notes produit et documentation opérationnelle des changements livrés."
      eyebrow="Release notes"
    >
      <div className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                Current release
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                Runtime Swarm, app scaling and clean CI/CD rollouts
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">
                Ploydok can now run application workloads through Docker Swarm
                services. This unlocks replica-based scaling, start-first
                updates, internal load balancing, and Watchtower-driven image
                rollouts without manually replacing containers on the VPS.
              </p>
            </div>
            <div className="grid min-w-[220px] gap-2 rounded-md border border-border bg-background p-3 text-sm">
              <MetaRow label="Version" value={APP_VERSION} />
              <MetaRow label="Default runtime" value="Swarm" />
              <MetaRow label="Update order" value="Start first" />
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <SummaryCard
            icon={RiScales3Line}
            title="Scale apps"
            body="Set the replica count per app. Swarm keeps the desired number of tasks running and balances requests across healthy replicas."
          />
          <SummaryCard
            icon={RiGitBranchLine}
            title="Zero-downtime updates"
            body="Start-first updates create the new task before stopping the previous one, then roll back automatically when the service fails to stabilize."
          />
          <SummaryCard
            icon={RiLoopLeftLine}
            title="Clean rollouts"
            body="CI publishes images, Watchtower updates the server, and cleanup removes older images after successful replacement."
          />
        </section>

        <ReleaseSection
          eyebrow="Where to configure it"
          title="App scaling lives in Build & runtime settings"
          description="Scaling is configured per application, not globally. Open the app details page and edit the runtime block."
        >
          <ol className="space-y-3 text-sm leading-6">
            <li>
              1. Open <strong>Applications</strong>, then select the app.
            </li>
            <li>
              2. Go to <strong>Deployments</strong>.
            </li>
            <li>
              3. Open <strong>Build & runtime settings</strong>.
            </li>
            <li>
              4. Keep <strong>Runtime mode</strong> on <strong>Swarm</strong>,
              then change <strong>Replicas</strong>.
            </li>
            <li>
              5. Keep <strong>Update order</strong> on{" "}
              <strong>Start first</strong> for interruption-free app reloads.
            </li>
          </ol>
          <Callout>
            Apps with writable local volumes are intentionally limited to one
            replica. Shared writable storage must be solved before horizontal
            scaling is safe for that workload.
          </Callout>
        </ReleaseSection>

        <ReleaseSection
          eyebrow="Runtime behavior"
          title="What Swarm changes under the hood"
          description="The app no longer relies on a single long-lived Docker container as the runtime target."
        >
          <FeatureList
            items={[
              "Each Swarm app gets a deterministic service name used by Caddy as the upstream.",
              "Ploydok initializes single-node Swarm automatically on the VPS when needed.",
              "Project-level overlay networks keep app, database, and Caddy connectivity scoped to the project.",
              "Managed databases are attached to the project Swarm network with their existing DNS hostname, so app environment variables keep working after migration.",
              "The app row stores `runtime_mode=swarm`, `swarm_service_name`, and the desired replica count.",
            ]}
          />
        </ReleaseSection>

        <ReleaseSection
          eyebrow="Deployments"
          title="How reloads happen without service interruption"
          description="The clean path is CI/CD first, server reconciliation second."
        >
          <FeatureList
            items={[
              "A push to main builds and publishes the API, web, agent, Caddy, and Adminer images.",
              "Watchtower watches labelled production containers and pulls the new image when the release is available.",
              "The API and agent are both included in Watchtower updates so Swarm RPCs stay in lockstep.",
              "Swarm services use start-first updates by default, creating the replacement task before draining the old one.",
              "If a service update cannot reach healthy state, Swarm uses rollback behavior instead of leaving a broken service as the target.",
            ]}
          />
        </ReleaseSection>

        <ReleaseSection
          eyebrow="Storage hygiene"
          title="Image cleanup is part of the rollout"
          description="The server should not grow forever just because builds are frequent."
        >
          <FeatureList
            items={[
              "Watchtower runs with cleanup enabled and removes replaced image layers after successful updates.",
              "Ploydok keeps registry and build-cache cleanup jobs scheduled from the API boot process.",
              "The app runtime row no longer keeps the old container id once the app is migrated to Swarm.",
              "Existing project resources are reconciled on boot so a clean CI/CD rollout can repair network drift without manual SSH deploy steps.",
            ]}
          />
        </ReleaseSection>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Operational shortcut</h2>
              <p className="text-sm text-muted-foreground">
                The scaling control is available from each app runtime settings
                page. Use it after a successful deploy, then monitor the service
                state from the app detail screens.
              </p>
            </div>
            <a
              href="/apps"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              Open applications
              <RiArrowRightLine className="size-4" />
            </a>
          </div>
        </section>
      </div>
    </ShellPage>
  )
}

function MetaRow(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="font-medium">{props.value}</span>
    </div>
  )
}

function SummaryCard(props: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}): React.JSX.Element {
  const Icon = props.icon
  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{props.title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {props.body}
          </p>
        </div>
      </div>
    </article>
  )
}

function ReleaseSection(props: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="max-w-3xl space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {props.eyebrow}
        </p>
        <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {props.description}
        </p>
      </div>
      <div className="mt-5">{props.children}</div>
    </section>
  )
}

function FeatureList(props: { items: Array<string> }): React.JSX.Element {
  return (
    <ul className="space-y-3 text-sm leading-6">
      {props.items.map((item) => (
        <li key={item} className="flex gap-3">
          <RiCheckboxCircleLine className="mt-1 size-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Callout(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-5 flex gap-3 rounded-md border border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
      <RiSettings3Line className="mt-1 size-4 shrink-0 text-primary" />
      <div>{props.children}</div>
    </div>
  )
}
