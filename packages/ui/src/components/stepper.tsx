// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

type StepState = "active" | "completed" | "inactive"
type StepperOrientation = "horizontal" | "vertical"

type StepperContextValue = {
  activeStep: number
  orientation: StepperOrientation
}

type StepContextValue = {
  state: StepState
}

const StepperContext = React.createContext<StepperContextValue | null>(null)
const StepContext = React.createContext<StepContextValue | null>(null)

function useStepperContext(): StepperContextValue {
  const context = React.useContext(StepperContext)
  if (!context)
    throw new Error("Stepper components must be used inside Stepper")
  return context
}

function useStepContext(): StepContextValue {
  const context = React.useContext(StepContext)
  if (!context)
    throw new Error("Step components must be used inside StepperItem")
  return context
}

function Stepper({
  value,
  orientation = "horizontal",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  value: number
  orientation?: StepperOrientation
}): React.JSX.Element {
  const context = React.useMemo(
    () => ({ activeStep: value, orientation }),
    [orientation, value]
  )
  return (
    <StepperContext.Provider value={context}>
      <div
        data-slot="stepper"
        data-orientation={orientation}
        className={cn("w-full", className)}
        {...props}
      >
        {children}
      </div>
    </StepperContext.Provider>
  )
}

function StepperNav({
  className,
  ...props
}: React.ComponentProps<"nav">): React.JSX.Element {
  const { orientation } = useStepperContext()
  return (
    <nav
      data-slot="stepper-nav"
      data-orientation={orientation}
      className={cn(
        "group/stepper-nav inline-flex",
        orientation === "horizontal" ? "w-full flex-row" : "flex-col",
        className
      )}
      {...props}
    />
  )
}

function StepperItem({
  step,
  completed,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  step: number
  completed?: boolean
}): React.JSX.Element {
  const { activeStep, orientation } = useStepperContext()
  const state: StepState =
    completed || step < activeStep
      ? "completed"
      : step === activeStep
        ? "active"
        : "inactive"
  return (
    <StepContext.Provider value={{ state }}>
      <div
        data-slot="stepper-item"
        data-state={state}
        className={cn(
          "group/step flex",
          orientation === "horizontal"
            ? "items-center not-last:flex-1"
            : "flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </StepContext.Provider>
  )
}

function StepperIndicator({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  const { state } = useStepContext()
  return (
    <div
      data-slot="stepper-indicator"
      data-state={state}
      className={cn(
        "relative flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full border transition-[color,background-color,border-color,box-shadow]",
        className
      )}
      {...props}
    />
  )
}

function StepperSeparator({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  const { state } = useStepContext()
  const { orientation } = useStepperContext()
  return (
    <div
      data-slot="stepper-separator"
      data-state={state}
      className={cn(
        "rounded-sm bg-border",
        orientation === "horizontal" ? "mx-1 h-px flex-1" : "h-12 w-px",
        className
      )}
      {...props}
    />
  )
}

function StepperTitle({
  className,
  ...props
}: React.ComponentProps<"span">): React.JSX.Element {
  const { state } = useStepContext()
  return (
    <span
      data-slot="stepper-title"
      data-state={state}
      className={cn("block text-sm font-medium", className)}
      {...props}
    />
  )
}

function StepperDescription({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  const { state } = useStepContext()
  return (
    <div
      data-slot="stepper-description"
      data-state={state}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
}
