// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from "@tanstack/react-router"
import { RiShieldKeyholeLine } from "@remixicon/react"
import { useMe } from "../../lib/auth"

export function SecondFactorBanner(): React.JSX.Element | null {
  const { data: me } = useMe()
  if (!me?.needs_second_factor) return null

  return (
    <div
      role="alert"
      aria-live="polite"
      className="border-b border-amber-500/40 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="flex flex-col gap-2 px-4 py-2 text-xs md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-start gap-2">
          <RiShieldKeyholeLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="leading-5">
            <span className="font-semibold">Second facteur requis.</span>{" "}
            Pour protéger vos déploiements, configurez un second facteur
            (authenticator app, clé de secours, ou passkey supplémentaire).
            Les actions sensibles (déployer, redémarrer, modifier env/domaines…)
            sont bloquées tant que ce n&apos;est pas fait.
          </p>
        </div>
        <Link
          to="/settings/security/totp"
          className="shrink-0 self-start rounded-md border border-amber-600/40 bg-amber-100 px-3 py-1.5 text-[11px] font-medium text-amber-950 outline-none transition-colors hover:bg-amber-200 dark:border-amber-400/40 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900"
        >
          Configurer le 2FA
        </Link>
      </div>
    </div>
  )
}
