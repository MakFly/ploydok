# @ploydok/app-auditor

Small S8 package for auditing an application checkout against OSV.dev.

It is intentionally DB-free: API workers can use it after a successful build to
capture manifests, query OSV, and persist the resulting matches in Ploydok's
own tables.

Supported manifests:

- `package-lock.json`
- `bun.lock`
- `package.json` with exact versions
- `Cargo.lock`
- `composer.lock`
- `requirements.txt`

```ts
import { auditApp } from "@ploydok/app-auditor"

const report = await auditApp({ rootDir: "/tmp/app-checkout" })
```

CLI:

```bash
bunx ploydok-app-audit /tmp/app-checkout
```
