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

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000"

type Listener = (data: unknown) => void

interface EventsContextValue {
  connected: boolean
  subscribe: (eventType: string, cb: Listener) => () => void
}

const EventsContext = React.createContext<EventsContextValue | null>(null)

export function EventsProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [connected, setConnected] = React.useState(false)
  const listenersRef = React.useRef(new Map<string, Set<Listener>>())
  const esRef = React.useRef<EventSource | null>(null)

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true })
    esRef.current = es

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    // Ré-attache chaque event type déjà souscrit au moment du mount.
    // Nécessaire si un consumer s'est abonné avant que l'ES soit ouverte.
    for (const eventType of listenersRef.current.keys()) {
      attachListener(es, eventType, listenersRef.current)
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [])

  const subscribe = React.useCallback<EventsContextValue["subscribe"]>(
    (eventType, cb) => {
      let set = listenersRef.current.get(eventType)
      if (!set) {
        set = new Set<Listener>()
        listenersRef.current.set(eventType, set)
        // Attach le dispatcher UNE fois par type sur l'ES active.
        const es = esRef.current
        if (es) attachListener(es, eventType, listenersRef.current)
      }
      set.add(cb)

      return () => {
        const s = listenersRef.current.get(eventType)
        if (!s) return
        s.delete(cb)
        if (s.size === 0) listenersRef.current.delete(eventType)
      }
    },
    [],
  )

  const value = React.useMemo<EventsContextValue>(
    () => ({ connected, subscribe }),
    [connected, subscribe],
  )

  return (
    <EventsContext.Provider value={value}>{children}</EventsContext.Provider>
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
  const ctx = React.useContext(EventsContext)
  const cbRef = React.useRef(callback)
  React.useEffect(() => {
    cbRef.current = callback
  })

  React.useEffect(() => {
    if (!ctx) return
    const unsub = ctx.subscribe(eventType, (data) => {
      cbRef.current(data as T)
    })
    return unsub
  }, [ctx, eventType])
}

export function useEventsConnected(): boolean {
  const ctx = React.useContext(EventsContext)
  return ctx?.connected ?? false
}
