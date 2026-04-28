// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { auditApp, collectManifestDependencies, type FetchLike } from "./index"

let tempDir: string

beforeEach(async () => {
  tempDir = await Bun.fileURLToPath(new URL(`./app-auditor-${crypto.randomUUID()}/`, Bun.env.TMPDIR ? `file://${Bun.env.TMPDIR}/` : "file:///tmp/"))
  await mkdir(tempDir, { recursive: true })
})

afterEach(async () => {
  await Bun.$`rm -rf ${tempDir}`.quiet()
})

describe("collectManifestDependencies", () => {
  it("parses lockfiles across supported ecosystems", async () => {
    await writeFile(
      join(tempDir, "package-lock.json"),
      JSON.stringify({
        packages: {
          "": {},
          "node_modules/express": { version: "4.18.2" },
          "node_modules/@scope/pkg": { version: "1.2.3", dev: true },
          "node_modules/express/node_modules/debug": { version: "2.6.9" },
        },
      }),
    )
    await writeFile(
      join(tempDir, "Cargo.lock"),
      `[[package]]
name = "axum"
version = "0.7.5"
source = "registry+https://github.com/rust-lang/crates.io-index"
`,
    )
    await writeFile(
      join(tempDir, "composer.lock"),
      JSON.stringify({
        packages: [{ name: "symfony/http-foundation", version: "v6.4.0" }],
        "packages-dev": [{ name: "phpunit/phpunit", version: "10.5.0" }],
      }),
    )
    await writeFile(join(tempDir, "requirements.txt"), "Django==4.2.0\nrequests[socks]==2.31.0\n")

    const manifests = await collectManifestDependencies(tempDir)
    const names = manifests.flatMap((manifest) => manifest.dependencies.map((dependency) => `${dependency.ecosystem}:${dependency.name}@${dependency.version}`))

    expect(names).toContain("npm:express@4.18.2")
    expect(names).toContain("npm:@scope/pkg@1.2.3")
    expect(names).toContain("npm:debug@2.6.9")
    expect(names).toContain("crates.io:axum@0.7.5")
    expect(names).toContain("Packagist:symfony/http-foundation@6.4.0")
    expect(names).toContain("Packagist:phpunit/phpunit@10.5.0")
    expect(names).toContain("PyPI:django@4.2.0")
    expect(names).toContain("PyPI:requests@2.31.0")
  })

  it("uses bun.lock and skips sibling package.json ranges", async () => {
    await writeFile(
      join(tempDir, "bun.lock"),
      `"packages": {
  "hono": ["hono@4.12.14", "", {}],
  "@types/bun": ["@types/bun@1.3.12", "", {}],
  "@ploydok/shared": ["@ploydok/shared@workspace:packages/shared"],
}`,
    )
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({
        dependencies: {
          hono: "^4.12.0",
        },
      }),
    )

    const manifests = await collectManifestDependencies(tempDir)
    const dependencies = manifests.flatMap((manifest) => manifest.dependencies)

    expect(dependencies).toHaveLength(2)
    expect(dependencies.map((dependency) => dependency.name)).toEqual(["@types/bun", "hono"])
  })
})

describe("auditApp", () => {
  it("queries OSV and returns matches", async () => {
    await writeFile(
      join(tempDir, "requirements.txt"),
      "jinja2==2.4.1\nsafe-package==1.0.0\n",
    )

    const requestedUrls: string[] = []
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input)
      requestedUrls.push(url)

      if (url.endsWith("/v1/querybatch")) {
        const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> }
        return Response.json({
          results: body.queries.map((query) =>
            query.package.name === "jinja2"
              ? { vulns: [{ id: "PYSEC-2014-8", modified: "2024-01-01T00:00:00Z" }] }
              : {},
          ),
        })
      }

      if (url.endsWith("/v1/vulns/PYSEC-2014-8")) {
        return Response.json({ id: "PYSEC-2014-8", summary: "test advisory" })
      }

      return new Response("not found", { status: 404 })
    }

    const report = await auditApp({
      rootDir: tempDir,
      baseUrl: "https://osv.test",
      fetchImpl,
    })

    expect(requestedUrls).toContain("https://osv.test/v1/querybatch")
    expect(report.dependencyCount).toBe(2)
    expect(report.matches).toHaveLength(1)
    expect(report.matches[0]?.dependency.name).toBe("jinja2")
    expect(report.vulnerabilityDetails["PYSEC-2014-8"]?.summary).toBe("test advisory")
  })
})
