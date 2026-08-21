// SPDX-License-Identifier: AGPL-3.0-only
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach } from "bun:test"
import i18n from "../lib/i18n"

GlobalRegistrator.register({
  url: "http://localhost:5173",
})

void i18n.changeLanguage("en")

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
