// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  RiArrowRightSLine,
  RiShip2Line,
  RiFingerprintLine,
  RiGithubFill,
  RiGitlabFill,
  RiShieldCheckLine,
  RiUserLine,
} from "@remixicon/react"
import { ShellPage } from "../../../components/layout/AppShell"
import { SettingsTabs } from "../../../components/settings/SettingsTabs"
import { useMe } from "../../../lib/auth"

export const Route = createFileRoute("/_authed/settings/")({
  component: SettingsOverviewPage,
})

interface SectionCard {
  to: string
  eyebrow: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const SECTIONS: ReadonlyArray<SectionCard> = [
  {
    to: "/settings/security",
    eyebrow: "Account",
    title: "Security",
    description: "Passkeys, TOTP, sessions and backup codes.",
    icon: RiShieldCheckLine,
  },
  {
    to: "/settings/git-providers",
    eyebrow: "Sources",
    title: "Git providers",
    description: "Connect GitHub and GitLab to deploy from a repo.",
    icon: RiGithubFill,
  },
  {
    to: "/settings/registry",
    eyebrow: "Sources",
    title: "Registry credentials",
    description: "Authentifie tes registres Docker privés pour déployer des images.",
    icon: RiShip2Line,
  },
]

function SettingsOverviewPage(): React.JSX.Element {
  const { data: me } = useMe()

  return (
    <ShellPage
      title="Settings"
      description="Manage your account, identities, and deployment sources."
      eyebrow="Account"
    >
      <div className="space-y-6">
        <SettingsTabs />

        <section
          aria-label="Account"
          className="rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <RiUserLine className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">
                {me?.display_name ?? "Utilisateur"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {me?.email}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Passkeys
              </dt>
              <dd className="mt-0.5 font-medium">
                {me?.has_passkey_plus ? "2+ registered" : "Configure"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                TOTP
              </dt>
              <dd className="mt-0.5 font-medium">
                {me?.has_totp ? "Enabled" : "Disabled"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                Backup codes
              </dt>
              <dd className="mt-0.5 font-medium">
                {me?.has_backup_codes ? "Available" : "None"}
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-label="Sections"
          className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
        >
          {SECTIONS.map((s) => (
            <SectionLink key={s.to} section={s} />
          ))}
        </section>

        <section
          aria-label="Coming soon"
          className="grid gap-3 md:grid-cols-2"
        >
          <ComingSoonCard
            icon={RiGitlabFill}
            title="GitLab"
            hint="OAuth app + webhook — configurable dans Git providers."
          />
          <ComingSoonCard
            icon={RiFingerprintLine}
            title="API tokens"
            hint="Émission + rotation — arrive avec le sprint suivant."
          />
        </section>
      </div>
    </ShellPage>
  )
}

function SectionLink({ section }: { section: SectionCard }): React.JSX.Element {
  const Icon = section.icon
  return (
    <Link
      to={section.to}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <Icon className="size-4 text-muted-foreground group-hover:text-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          {section.eyebrow}
        </p>
        <p className="text-sm font-medium">{section.title}</p>
        <p className="text-xs text-muted-foreground">{section.description}</p>
      </div>
      <RiArrowRightSLine className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  )
}

function ComingSoonCard({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-background/70">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}
