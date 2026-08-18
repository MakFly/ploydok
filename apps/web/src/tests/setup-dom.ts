// SPDX-License-Identifier: AGPL-3.0-only
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach } from "bun:test"

GlobalRegistrator.register({
  url: "http://localhost:5173",
})

const registeredWindow = globalThis.window
const registeredDocument = globalThis.document

function restoreDomGlobals(): void {
  globalThis.window = registeredWindow
  globalThis.document = registeredDocument
}

// Several SSR-focused tests temporarily replace `window`/`document`. Keep that
// isolation local even when Bun loads test files in a different order.
beforeEach(restoreDomGlobals)
afterEach(restoreDomGlobals)
