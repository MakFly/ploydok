// SPDX-License-Identifier: AGPL-3.0-only

export interface LocalS3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export function localS3Config(): LocalS3Config {
  return {
    endpoint: "http://127.0.0.1:3900",
    region: "garage",
    bucket: "ploydok-test",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
  }
}
