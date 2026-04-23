// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authed/apps/$")({
  beforeLoad: ({ context, params }) => {
    const slug = context.me?.default_organization?.slug
    if (!slug) throw redirect({ to: "/login" })
    const rest = params._splat ? `/${params._splat}` : ""
    throw redirect({ href: `/orgs/${slug}/apps${rest}` })
  },
})
