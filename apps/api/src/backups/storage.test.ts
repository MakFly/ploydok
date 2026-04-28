// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import type { Db } from "@ploydok/db"
import { writeBackupStream } from "./storage"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("writeBackupStream", () => {
  it("writes local backup streams atomically and counts bytes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ploydok-backup-storage-"))
    tempDirs.push(dir)

    const location = path.join(dir, "backup.dump")
    const source = Readable.from([Buffer.from("hello "), Buffer.from("world")])

    const result = await writeBackupStream(
      {} as Db,
      {
        destination_kind: "local",
        s3_endpoint: null,
        s3_bucket: null,
        s3_prefix: null,
        s3_region: null,
        s3_credentials_secret_id: null,
      },
      location,
      source
    )

    expect(result.sizeBytes).toBe(11)
    expect(await readFile(location, "utf8")).toBe("hello world")
  })
})
