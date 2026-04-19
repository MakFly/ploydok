// SPDX-License-Identifier: AGPL-3.0-only
//
// EventsProvider — ouvre UNE seule EventSource vers /events et multiplexe les
// events nommés auprès des consumers via Context. Remplace les EventSource
// multiples ouvertes par useNotifications + useMonitoringEvents.
//
// Usage:
//   <EventsProvider>          ← monté dans _authed.tsx (1 instance par session authed)
//     <App />
//   </EventsProvider>
//
//   // dans un hook consumer :
//   useEventsSubscription("container.health", (data) => { ... })

import * as React from "react"

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3335"

type Listener = (data: unknown) => void
type Subscribe = (eventType: string, cb: Listener) => () => void

const SubscribeContext = React.createContext<Subscribe | null>(null)
const ConnectedContext = React.createContext<boolean>(false)

export function EventsProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [connected, setConnected] = React.useState(false)
  const listenersRef = React.useRef(new Map<string, Set<Listener>>())
  const attachedRef = React.useRef(new Set<string>())
  const esRef = React.useRef<EventSource | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true })
    esRef.current = es
    attachedRef.current = new Set<string>()

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    // Re-attach every event type already subscribed at the time of mount.
    // Needed if a consumer subscribed before the EventSource was opened.
    for (const eventType of listenersRef.current.keys()) {
      if (!attachedRef.current.has(eventType)) {
        attachListener(es, eventType, listenersRef.current)
        attachedRef.current.add(eventType)
      }
    }

    return () => {
      es.close()
      esRef.current = null
      attachedRef.current = new Set<string>()
      setConnected(false)
    }
  }, [])

  const subscribe = React.useCallback<Subscribe>((eventType, cb) => {
    let set = listenersRef.current.get(eventType)
    if (!set) {
      set = new Set<Listener>()
      listenersRef.current.set(eventType, set)
    }
    set.add(cb)

    // Attach the DOM dispatcher at most once per type per EventSource,
    // tracked via attachedRef. Previous impl re-attached when the Set was
    // emptied then re-populated — that duplicated listener calls on every
    // resubscription (e.g. after a `connected` flip).
    const es = esRef.current
    if (es && !attachedRef.current.has(eventType)) {
      attachListener(es, eventType, listenersRef.current)
      attachedRef.current.add(eventType)
    }

    return () => {
      const s = listenersRef.current.get(eventType)
      if (!s) return
      s.delete(cb)
      // Keep the empty Set in the map so the attached listener stays
      // registered — no removeEventListener handle available anyway.
    }
  }, [])

  return (
    <SubscribeContext.Provider value={subscribe}>
      <ConnectedContext.Provider value={connected}>
        {children}
      </ConnectedContext.Provider>
    </SubscribeContext.Provider>
  )
}

/** Attache un listener unique par type qui dispatch vers tous les abonnés. */
function attachListener(
  es: EventSource,
  eventType: string,
  map: Map<string, Set<Listener>>,
): void {
  es.addEventListener(eventType, (ev: Event) => {
    const set = map.get(eventType)
    if (!set || set.size === 0) return
    const msgEvent = ev as MessageEvent<string>
    let parsed: unknown
    try {
      parsed = JSON.parse(msgEvent.data)
    } catch {
      return
    }
    for (const cb of set) {
      try {
        cb(parsed)
      } catch {
        // Subscriber errors must not crash the dispatcher.
      }
    }
  })
}

export function useEventsSubscription<T>(
  eventType: string,
  callback: (data: T) => void,
): void {
  const subscribe = React.useContext(SubscribeContext)
  const cbRef = React.useRef(callback)
  React.useEffect(() => {
    cbRef.current = callback
  })

  React.useEffect(() => {
    if (!subscribe) return
    const unsub = subscribe(eventType, (data) => {
      cbRef.current(data as T)
    })
    return unsub
  }, [subscribe, eventType])
}

export function useEventsConnected(): boolean {
  return React.useContext(ConnectedContext)
}
