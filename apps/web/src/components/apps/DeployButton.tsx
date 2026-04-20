// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react"
import { useRouter } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useDeployApp } from "../../lib/apps-mutations"
import { useActiveBuild } from "../../lib/hooks/use-active-build"
import { useMe } from "../../lib/auth"

// ---------------------------------------------------------------------------
// DeployButton — split-button: primary Deploy + dropdown for variants
// ---------------------------------------------------------------------------

interface DeployButtonProps {
  appId: string
}

export function DeployButton({ appId }: DeployButtonProps): React.JSX.Element {
  const router = useRouter()
  const deploy = useDeployApp(appId)
  const { isActive } = useActiveBuild(appId)
  const { data: me } = useMe()
  const needs2FA = Boolean(me?.needs_second_factor)

  const handleDeploy = async (opts?: { rebuild?: boolean; noCache?: boolean }): Promise<void> => {
    try {
      await deploy.mutateAsync(opts)
      // Navigate to the deployments tab after deploy kicks off.
      void router.navigate({
        to: "/apps/$id/deployments",
        params: { id: appId },
      })
    } catch {
      // Errors surfaced via deploy.error — no need to rethrow
    }
  }

  const disabled = isActive || deploy.isPending || needs2FA
  const lockTitle = needs2FA
    ? "Configurez un second facteur (passkey additionnel, TOTP ou backup codes) pour déployer."
    : undefined

  return (
    <div className="flex items-center">
      {/* Primary deploy button */}
      <Button
        size="sm"
        disabled={disabled}
        onClick={() => void handleDeploy()}
        className="rounded-r-none border-r-0"
        title={lockTitle}
      >
        {needs2FA && !isActive && !deploy.isPending ? (
          "Deploy"
        ) : disabled ? (
          <span className="flex items-center gap-1.5">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
            Deploying…
          </span>
        ) : (
          "Deploy"
        )}
      </Button>

      {/* Dropdown trigger for deploy variants */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="rounded-l-none px-2"
            aria-label="More deploy options"
            title={lockTitle}
          >
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => void handleDeploy({ rebuild: true })}
            disabled={disabled}
          >
            Redeploy (same commit)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void handleDeploy({ rebuild: true, noCache: true })}
            disabled={disabled}
          >
            Rebuild without cache
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function LoaderIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
