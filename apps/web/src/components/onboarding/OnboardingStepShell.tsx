// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { RiCheckLine, RiLogoutBoxRLine } from "@remixicon/react"
import { Button } from "@workspace/ui/components/button"
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from "@workspace/ui/components/stepper"
import { cn } from "@workspace/ui/lib/utils"
import { useTranslation } from "react-i18next"
import { ThemeToggle } from "../theme/ThemeToggle"

export type OnboardingStep = "provider" | "project" | "deploy"

const stepOrder: Array<OnboardingStep> = ["provider", "project", "deploy"]

const STEP_KEYS: Record<
  OnboardingStep,
  { label: string; description: string }
> = {
  provider: {
    label: "steps.provider.label",
    description: "steps.provider.description",
  },
  project: {
    label: "steps.project.label",
    description: "steps.project.description",
  },
  deploy: {
    label: "steps.deploy.label",
    description: "steps.deploy.description",
  },
}

export function OnboardingStepShell({
  activeStep,
  children,
  onBack,
  onLogout,
}: {
  activeStep: OnboardingStep
  children: React.ReactNode
  onBack?: () => void
  onLogout: () => void
}): React.JSX.Element {
  const { t } = useTranslation("onboarding")
  const activeIndex = stepOrder.indexOf(activeStep)

  return (
    <main className="relative flex min-h-dvh bg-background text-foreground">
      <div className="absolute top-4 right-4 z-20 hidden md:block">
        <ThemeToggle />
      </div>
      <aside className="hidden w-[15rem] shrink-0 p-2 md:block md:w-[19rem] md:p-3 lg:w-[22rem] lg:p-4">
        <div className="relative isolate flex h-full min-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-[#f7f7f8] px-5 pb-5 text-foreground dark:bg-[#09090b]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(94,106,210,0.62)_0_1px,transparent_1.5px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)] [background-size:19px_19px] opacity-90 dark:opacity-0"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(94,106,210,0.65)_0_1px,transparent_1.5px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)] [background-size:19px_19px] opacity-0 dark:opacity-70"
          />
          <div className="relative flex min-h-0 flex-1 flex-col pt-5">
            <header className="flex min-h-9 items-center justify-between gap-3">
              <BrandMark />
              {onBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onBack}
                  aria-label={t("back")}
                >
                  <span aria-hidden>←</span>
                </Button>
              ) : null}
            </header>

            <Stepper
              value={activeIndex + 1}
              orientation="vertical"
              role="group"
              aria-label={t("progress")}
              className="my-auto flex flex-col justify-center py-10"
            >
              <StepperNav aria-label={t("progress")} className="w-full">
                {stepOrder.map((step, index) => {
                  const complete = index < activeIndex
                  const current = index === activeIndex
                  const last = index === stepOrder.length - 1
                  return (
                    <StepperItem
                      key={step}
                      step={index + 1}
                      completed={complete}
                      aria-current={current ? "step" : undefined}
                      className="relative w-full items-start"
                    >
                      <div
                        className={cn(
                          "flex w-full items-start gap-3",
                          !last && "pb-7"
                        )}
                      >
                        <StepperIndicator
                          className={cn(
                            "z-10 mt-0.5",
                            complete
                              ? "border-foreground bg-foreground text-background"
                              : current
                                ? "border-muted-foreground/50 bg-muted shadow-sm"
                                : "border-border bg-background"
                          )}
                        >
                          {complete ? (
                            <RiCheckLine aria-hidden className="size-3" />
                          ) : current ? (
                            <span
                              aria-hidden
                              className="size-2 rounded-full bg-foreground"
                            />
                          ) : null}
                        </StepperIndicator>
                        <div className="min-w-0 flex-1">
                          <StepperTitle
                            className={cn(
                              current || complete
                                ? "text-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {t(STEP_KEYS[step].label)}
                          </StepperTitle>
                          <StepperDescription className="mt-0.5 leading-5">
                            {t(STEP_KEYS[step].description)}
                          </StepperDescription>
                        </div>
                      </div>
                      {!last ? (
                        <StepperSeparator
                          aria-hidden
                          className={cn(
                            "absolute top-[22px] left-[9px] h-[calc(100%-0.4rem)] -translate-x-1/2",
                            complete ? "bg-muted-foreground" : "bg-border"
                          )}
                        />
                      ) : null}
                    </StepperItem>
                  )
                })}
              </StepperNav>
            </Stepper>

            <footer className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit justify-start"
                onClick={onLogout}
              >
                <RiLogoutBoxRLine aria-hidden className="size-3.5" />
                {t("logOut")}
              </Button>
            </footer>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-8 sm:px-10 md:px-14 lg:py-10">
        <div className="mx-auto flex w-full max-w-[28rem] shrink-0 items-center gap-3 pb-6 md:hidden">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
            >
              <span aria-hidden>←</span>
              <span className="sr-only">{t("back")}</span>
            </Button>
          ) : null}
          <span aria-hidden className="flex flex-1 items-center gap-1.5">
            {stepOrder.map((step, index) => (
              <span
                key={step}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  index <= activeIndex ? "bg-foreground" : "bg-border"
                )}
              />
            ))}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {t(STEP_KEYS[activeStep].label)}
          </span>
          <ThemeToggle />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onLogout}
          >
            <RiLogoutBoxRLine aria-hidden className="size-3.5" />
            <span className="sr-only">{t("logOut")}</span>
          </Button>
        </div>
        {/* m-auto rather than justify-center: in a scrollable flex column,
            centering through alignment clips the top once content overflows. */}
        <div className="m-auto flex w-full max-w-[28rem] flex-col">
          {children}
        </div>
      </section>
    </main>
  )
}

export function StepHeading({
  title,
  description,
}: {
  title: React.ReactNode
  description?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-[-0.025em] text-balance">
        {title}
      </h1>
      {description ? (
        <p className="text-sm leading-6 text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  )
}

export function StepFooter({
  children,
  hint,
}: {
  children: React.ReactNode
  hint?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 pt-10">
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  )
}

export function ChoiceCard({
  selected,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { selected: boolean }): React.JSX.Element {
  return (
    <div
      data-selected={selected}
      className={cn(
        "group flex min-h-9 items-center gap-2 rounded-lg border bg-card px-3 py-2 transition-[color,background-color,border-color,box-shadow] duration-150 outline-none",
        selected
          ? "border-foreground bg-muted shadow-[inset_0_0_0_1px_var(--foreground)]"
          : "border-border hover:border-foreground/20 hover:bg-accent/30",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function BrandMark(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold tracking-[-0.02em]">
      <img
        src="/ploydok-mark.png"
        alt=""
        className="size-5 shrink-0 object-contain"
      />
      Ploydok
    </div>
  )
}
