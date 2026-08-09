// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M5 11h14v2H5z" />
    </svg>
  )
}

export function Card({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-panel text-sm text-neutral-950 dark:text-neutral-50",
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-neutral-500">{children}</div>
}

export function BigNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-2xl font-medium tabular-nums text-neutral-950 dark:text-neutral-50">
      {children}
    </span>
  )
}

export function Delta({
  value,
  tone,
}: {
  value: string
  tone: "pos" | "neg" | "flat"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-sm font-medium leading-5 tabular-nums",
        tone === "pos" && "bg-[#d9f99d] text-[#3c6300]",
        tone === "neg" && "bg-[#ffccd3] text-[#a50036]",
        tone === "flat" && "bg-neutral-200 text-neutral-500 dark:bg-neutral-800"
      )}
    >
      {value}
    </span>
  )
}

export function SegTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}) {
  const idx = options.indexOf(value)
  const cols = options.length
  return (
    <div
      className="relative grid items-center rounded-lg p-0.5 text-sm"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      <span
        className="absolute top-0.5 bottom-0.5 rounded-md border border-border bg-background transition-[left,width] duration-300 ease-out"
        style={{
          left: `calc(2px + ${idx} * ((100% - 4px) / ${cols}))`,
          width: `calc((100% - 4px) / ${cols})`,
        }}
      />
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "relative z-10 px-2.5 py-1 text-center transition-colors duration-200",
            option === value
              ? "font-medium text-neutral-950 dark:text-neutral-50"
              : "font-normal text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export function Menu({
  trigger,
  options,
  value,
  onSelect,
  align = "start",
  width = 160,
  matchTrigger = false,
  fullWidth = false,
  leading,
}: {
  trigger: (open: boolean) => React.ReactNode
  options: string[]
  value?: string
  onSelect: (value: string) => void
  align?: "start" | "end"
  width?: number
  matchTrigger?: boolean
  fullWidth?: boolean
  leading?: (option: string) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [triggerW, setTriggerW] = React.useState<number>()
  const ref = React.useRef<HTMLDivElement>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const toggle = () => {
    if (!open && matchTrigger) {
      setTriggerW(btnRef.current?.offsetWidth)
    }
    setOpen((current) => !current)
  }

  return (
    <div className={cn("relative", fullWidth && "w-full")} ref={ref}>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={cn(fullWidth && "w-full")}
      >
        {trigger(open)}
      </button>
      {open ? (
        <div
          style={matchTrigger ? { width: triggerW } : { minWidth: width }}
          className={cn(
            "absolute z-40 mt-1.5 origin-top overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-[var(--shadow-elevated)]",
            "animate-in fade-in-0 zoom-in-95 duration-150",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onSelect(option)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {leading?.(option)}
                <span className="truncate">{option}</span>
              </span>
              {value === option ? (
                <CheckIcon className="size-3.5 shrink-0 text-[#155dfc]" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PagerButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[10px] border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:border-input hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function BoardUICheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
}) {
  const on = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      onClick={onChange}
      className={cn(
        "flex size-4 items-center justify-center rounded-[5px] border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#3080ff] focus-visible:ring-offset-1",
        on
          ? "border-[#155dfc] bg-[image:var(--gradient-primary)] shadow-[inset_0_1px_0_0_#ffffff40]"
          : "border-input bg-background hover:border-ring"
      )}
    >
      {indeterminate ? (
        <MinusIcon className="size-3 text-white" />
      ) : checked ? (
        <CheckIcon className="size-3 text-white" />
      ) : null}
    </button>
  )
}
