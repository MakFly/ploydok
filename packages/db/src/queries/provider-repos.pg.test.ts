// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { nanoid } from "nanoid"
import { createDb } from "../client"
import { provider_installations } from "../schema"
import {
  listRepos,
  replaceInstallationRepos,
  upsertInstallation,
  type ProviderRepoRow,
} from "./provider-repos"
import { inArray } from "drizzle-orm"

const PG_URL = Bun.env["PLOYDOK_TEST_PG_URL"]
const skip = !PG_URL
if (skip) {
  console.log("[provider-repos.pg.test] PLOYDOK_TEST_PG_URL not set — skipping")
}

describe.skipIf(skip)("provider repo installation isolation", () => {
  const db = createDb(PG_URL!)
  const suffix = nanoid().toLowerCase()
  const installationA = `gitlab:user:a-${suffix}`
  const installationB = `gitlab:user:b-${suffix}`

  beforeAll(async () => {
    const now = new Date()
    await Promise.all(
      [installationA, installationB].map((id) =>
        upsertInstallation(db, {
          id,
          provider: "gitlab",
          external_id: id,
          account_login: id,
          account_type: "User",
          repository_selection: "all",
          suspended_at: null,
          html_url: null,
          avatar_url: null,
          repository_count: 1,
          last_synced_at: now,
          created_at: now,
        })
      )
    )
  })

  afterAll(async () => {
    await db
      .delete(provider_installations)
      .where(inArray(provider_installations.id, [installationA, installationB]))
    await db.$client.end()
  })

  it("keeps the same GitLab project id independently for concurrent users", async () => {
    const row = (
      installationId: string,
      fullName: string
    ): ProviderRepoRow => ({
      id: "gitlab:4242",
      installation_id: installationId,
      provider: "gitlab",
      full_name: fullName,
      name: "project",
      description: null,
      default_branch: "main",
      private: true,
      html_url: `https://gitlab.example/${fullName}`,
      pushed_at: null,
      updated_at: null,
      last_synced_at: new Date(),
    })

    await Promise.all([
      replaceInstallationRepos(db, installationA, [
        row(installationA, "a/project"),
      ]),
      replaceInstallationRepos(db, installationB, [
        row(installationB, "b/project"),
      ]),
    ])

    const [reposA, reposB] = await Promise.all([
      listRepos(db, {
        provider: "gitlab",
        installationIds: [installationA],
        limit: 10,
        offset: 0,
      }),
      listRepos(db, {
        provider: "gitlab",
        installationIds: [installationB],
        limit: 10,
        offset: 0,
      }),
    ])
    expect(reposA.rows.map((repo) => repo.full_name)).toEqual(["a/project"])
    expect(reposB.rows.map((repo) => repo.full_name)).toEqual(["b/project"])
  })
})
