// SPDX-License-Identifier: AGPL-3.0-only
// Route53 DNS-01 provider via AWS REST API + SigV4 signing.
// We use a minimal SigV4 implementation to avoid pulling the full AWS SDK.
import { createHmac, createHash } from "node:crypto"
import type { Dns01Provider, TxtRecord, Route53Credentials, FetchFn } from "./types.js"

const R53_ENDPOINT = "https://route53.amazonaws.com"
const SERVICE = "route53"

// ---------------------------------------------------------------------------
// Minimal SigV4 signer
// ---------------------------------------------------------------------------

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest()
}

function sha256hex(data: string): string {
  return createHash("sha256").update(data).digest("hex")
}

function sign(
  method: string,
  url: URL,
  body: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
): Record<string, string> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]/g, "").split(".")[0] + "Z"
  const dateStamp = amzDate.slice(0, 8)

  const canonicalUri = url.pathname
  const canonicalQueryString = url.searchParams.toString()
  const payloadHash = sha256hex(body)

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    "content-type": "application/xml",
  }

  const sortedKeys = Object.keys(headers).sort()
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join("")
  const signedHeaders = sortedKeys.join(";")

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n")

  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(hmacSha256(`AWS4${secretAccessKey}`, dateStamp), region),
      SERVICE,
    ),
    "aws4_request",
  )

  const signature = hmacSha256(signingKey, stringToSign).toString("hex")
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { ...headers, Authorization: authorization }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createRoute53Provider(
  creds: Route53Credentials,
  zoneId: string,
  fetchFn: FetchFn = fetch,
): Dns01Provider {
  const region = creds.region ?? "us-east-1"

  async function changeResourceRecordSets(xml: string): Promise<string> {
    const path = `/2013-04-01/hostedzone/${zoneId}/rrset`
    const url = new URL(`${R53_ENDPOINT}${path}`)
    const hdrs = sign("POST", url, xml, region, creds.access_key_id, creds.secret_access_key)

    const res = await fetchFn(url.toString(), {
      method: "POST",
      headers: hdrs,
      body: xml,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`route53.changeResourceRecordSets failed (${res.status}): ${text}`)
    }
    // Extract ChangeId from XML <Id>/change/CXXXXXXX</Id>
    const match = /<Id>(.+?)<\/Id>/.exec(text)
    return match?.[1] ?? ""
  }

  return {
    name: "route53",

    async createTXTRecord(_zone, name, value): Promise<TxtRecord> {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>
    <Changes>
      <Change>
        <Action>UPSERT</Action>
        <ResourceRecordSet>
          <Name>${name}</Name>
          <Type>TXT</Type>
          <TTL>10</TTL>
          <ResourceRecords>
            <ResourceRecord><Value>"${value}"</Value></ResourceRecord>
          </ResourceRecords>
        </ResourceRecordSet>
      </Change>
    </Changes>
  </ChangeBatch>
</ChangeResourceRecordSetsRequest>`

      const changeId = await changeResourceRecordSets(xml)
      // Route53 uses change IDs not record IDs — encode zone+name so we can delete later
      return { recordId: `${changeId}|${name}` }
    },

    async deleteTXTRecord(_zone, recordId): Promise<void> {
      // recordId = "<changeId>|<name>" — we only need the name to delete
      const name = recordId.split("|")[1] ?? recordId
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>
    <Changes>
      <Change>
        <Action>DELETE</Action>
        <ResourceRecordSet>
          <Name>${name}</Name>
          <Type>TXT</Type>
          <TTL>10</TTL>
          <ResourceRecords>
            <ResourceRecord><Value>"${name}"</Value></ResourceRecord>
          </ResourceRecords>
        </ResourceRecordSet>
      </Change>
    </Changes>
  </ChangeBatch>
</ChangeResourceRecordSetsRequest>`

      await changeResourceRecordSets(xml)
    },
  }
}
