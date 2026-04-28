// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, writeFile } from "node:fs/promises"

await mkdir("dist/assets", { recursive: true })
await writeFile(
  "dist/index.html",
  '<!doctype html><html><head><script src="/assets/app.js"></script></head><body><img src="/hero.jpg" alt=""><h1>large-assets</h1></body></html>'
)
await writeFile("dist/assets/app.js", `export const payload = "${"x".repeat(1024 * 256)}";\n`)
await writeFile(
  "dist/hero.jpg",
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QE//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QE//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QE//Z",
    "base64"
  )
)
