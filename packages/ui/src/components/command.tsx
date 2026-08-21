// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { RiCheckLine, RiSearchLine } from "@remixicon/react"

import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  closeLabel,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  closeLabel?: string
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className
        )}
        showCloseButton={showCloseButton}
        closeLabel={closeLabel}
      >
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-13 shrink-0 items-center gap-3 border-b border-border px-4"
    >
      <RiSearchLine
        className="size-4.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-full w-full bg-transparent text-base outline-hidden placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "scrollbar-thin max-h-72 scroll-py-2 overflow-x-hidden overflow-y-auto overscroll-contain p-1.5 pr-1 outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("px-4 py-10 text-center text-sm", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden pb-1 text-foreground not-first:pt-2 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:tracking-[0.14em] **:[[cmdk-group-heading]]:text-muted-foreground/70 **:[[cmdk-group-heading]]:uppercase",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1.5 my-1.5 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex min-h-12 cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 sm:min-h-10 sm:py-1.5 data-selected:bg-muted data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <RiCheckLine className="ml-auto hidden group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:block" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-footer"
      className={cn(
        "flex shrink-0 items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandKbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="command-kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted/60 px-1 font-mono text-[10px] leading-none font-medium text-foreground/70",
        className
      )}
      {...props}
    />
  )
}

function CommandMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-meta"
      className={cn(
        "hidden max-w-[45%] truncate font-mono text-[11px] text-muted-foreground/70 group-data-selected/command-item:text-muted-foreground sm:block",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandItem,
  CommandKbd,
  CommandMeta,
  CommandShortcut,
  CommandSeparator,
}
