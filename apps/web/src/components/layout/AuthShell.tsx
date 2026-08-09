// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/** BoardUI iso public auth shell (login, setup, invitations). */
export function AuthShell({
  title,
  subtitle,
  eyebrow,
  children,
  className,
  showcase = false,
}: {
  title: string
  subtitle?: string
  eyebrow?: string
  children: React.ReactNode
  className?: string
  showcase?: boolean
}): React.JSX.Element {
  const form = (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col bg-background px-6 py-6 text-foreground sm:px-10 sm:py-8 lg:px-14 lg:py-10",
        showcase
          ? "min-h-svh"
          : "rounded-2xl border border-border shadow-[var(--shadow-elevated)]",
        className
      )}
    >
      <div className="flex items-center gap-2.5" aria-label="Ploydok">
        <img
          src="/ploydok-mark.png"
          alt=""
          className="size-8 object-contain"
          aria-hidden="true"
        />
        <span className="text-sm font-semibold tracking-[-0.015em]">
          Ploydok
        </span>
      </div>

      <div
        className={cn(
          "mx-auto flex w-full max-w-[410px] flex-1 flex-col justify-center",
          showcase ? "py-12 lg:py-16" : "py-10"
        )}
      >
        <header className="mb-8">
          {eyebrow ? (
            <p className="mb-3 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-foreground sm:text-[2rem]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </header>
        {children}
      </div>

      <p className="text-center text-[11px] text-muted-foreground/80">
        AGPL-3.0 · Self-hosted by design
      </p>
    </section>
  )

  if (!showcase) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/50 p-4 sm:p-8">
        <div className="w-full max-w-md">{form}</div>
      </main>
    )
  }

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-2">
      {form}
      <div className="relative hidden lg:block">
        <AuthShowcase />
      </div>
    </main>
  )
}

function AuthShowcase(): React.JSX.Element {
  return (
    <aside
      className="absolute inset-y-1 right-1 left-6 flex min-w-0 flex-col overflow-hidden rounded-[28px] bg-[oklch(0.235_0.055_258)] text-[oklch(0.97_0.006_250)] shadow-[0_24px_70px_rgba(18,32,58,0.16)] xl:left-8"
      aria-label="Ploydok platform overview"
    >
      <div
        className="absolute inset-0 opacity-90"
        style={{
          backgroundImage:
            "radial-gradient(circle at 75% 18%, oklch(0.63 0.2 255 / 0.32), transparent 34%), radial-gradient(circle at 18% 92%, oklch(0.68 0.16 220 / 0.18), transparent 38%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.13]"
        style={{
          backgroundImage:
            "linear-gradient(oklch(0.9 0.02 250 / 0.4) 1px, transparent 1px), linear-gradient(90deg, oklch(0.9 0.02 250 / 0.4) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "linear-gradient(to bottom, black, transparent 85%)",
        }}
      />

      <div className="relative z-10 flex items-center justify-between p-8 text-xs text-white/65 xl:p-10">
        <span className="font-mono tracking-[0.14em] uppercase">
          Control plane 01
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5">
          <span className="size-1.5 rounded-full bg-[oklch(0.78_0.18_145)] shadow-[0_0_14px_oklch(0.78_0.18_145)]" />
          Runtime connected
        </span>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center px-12 pb-16 xl:px-16">
        <p className="mb-5 font-mono text-xs tracking-[0.18em] text-[oklch(0.76_0.12_235)] uppercase">
          From commit to production
        </p>
        <h2 className="max-w-[650px] text-4xl leading-[1.02] font-semibold tracking-[-0.04em] text-balance xl:text-[3.5rem]">
          Deploy from Git.
          <br />
          Own the runtime.
        </h2>
        <p className="mt-5 max-w-[520px] text-sm leading-6 text-white/62 xl:text-base xl:leading-7">
          Connect a repository, ship through Docker Swarm, and keep every log,
          domain, rollout, and database under your control.
        </p>

        <div className="mt-12 max-w-[620px] rounded-[18px] border border-white/12 bg-[oklch(0.19_0.035_258/0.82)] p-3 shadow-[0_30px_90px_rgba(0,0,0,0.28)]">
          <div className="flex items-center justify-between border-b border-white/8 px-2 pb-3">
            <div className="flex items-center gap-2 text-xs text-white/58">
              <span className="size-2 rounded-full bg-[oklch(0.72_0.17_148)]" />
              api.production
            </div>
            <span className="font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">
              deploy #184
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-4 px-2 py-4 text-xs">
            <DeployStep
              index="01"
              label="Repository synced"
              meta="github/main"
              done
            />
            <DeployStep index="02" label="Image built" meta="sha-7f29a1" done />
            <DeployStep
              index="03"
              label="Blue/green rollout"
              meta="2/2 healthy"
              active
            />
          </div>
        </div>
      </div>

      <p className="relative z-10 p-8 text-xs text-white/38 xl:p-10">
        Security-first infrastructure for teams that ship.
      </p>
    </aside>
  )
}

function DeployStep({
  index,
  label,
  meta,
  done = false,
  active = false,
}: {
  index: string
  label: string
  meta: string
  done?: boolean
  active?: boolean
}): React.JSX.Element {
  return (
    <>
      <span className="font-mono text-[10px] text-white/32">{index}</span>
      <span className="flex items-center gap-2.5 text-white/82">
        <span
          className={cn(
            "size-2 rounded-full border",
            done && "border-[oklch(0.72_0.17_148)] bg-[oklch(0.72_0.17_148)]",
            active &&
              "border-[oklch(0.7_0.16_240)] bg-[oklch(0.7_0.16_240)] shadow-[0_0_16px_oklch(0.7_0.16_240/0.75)] motion-safe:animate-pulse"
          )}
        />
        {label}
      </span>
      <span className="font-mono text-[10px] text-white/40">{meta}</span>
    </>
  )
}

export const authFieldClass =
  "h-12 rounded-[10px] border border-input bg-background px-3.5 text-foreground shadow-[var(--shadow-xs)] transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/65 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"

export const authLabelClass = "text-sm font-medium text-foreground"
