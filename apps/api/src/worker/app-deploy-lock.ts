// SPDX-License-Identifier: AGPL-3.0-only

export type KeyedLock = <T>(key: string, task: () => Promise<T>) => Promise<T>

export function createInProcessKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<void>>()

  return async function withLock<T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })

    tails.set(key, current)
    await previous.catch(() => undefined)

    try {
      return await task()
    } finally {
      release()
      if (tails.get(key) === current) {
        tails.delete(key)
      }
    }
  }
}

export const withAppDeployLock = createInProcessKeyedLock()
