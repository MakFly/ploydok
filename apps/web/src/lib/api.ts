// SPDX-License-Identifier: AGPL-3.0-only

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

let _csrfToken: string | null = null;

async function fetchCsrf(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/csrf`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("Failed to fetch CSRF token");
  }
  const data = (await res.json()) as { token: string };
  _csrfToken = data.token;
  return _csrfToken;
}

async function getCsrfToken(): Promise<string> {
  if (_csrfToken) return _csrfToken;
  return fetchCsrf();
}

export function resetCsrfToken(): void {
  _csrfToken = null;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ApiRequestInit {
  method?: Method;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// En SSR (Node), `credentials: include` ne fait rien : le runtime n'a pas de
// cookie store. On forward manuellement le header Cookie de la requête HTTP
// entrante (via TanStack Start) pour que l'API reçoive les mêmes cookies que
// le navigateur. Sans ça, beforeLoad fait un fetch anonyme → 401 → redirect
// login au F5 alors que l'utilisateur est authentifié.
async function getServerCookieHeader(): Promise<string | undefined> {
  if (typeof window !== "undefined") return undefined;
  try {
    const mod = (await import("@tanstack/react-start/server")) as {
      getRequestHeader?: (name: string) => string | undefined;
    };
    return mod.getRequestHeader?.("cookie");
  } catch {
    return undefined;
  }
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  const serverCookie = await getServerCookieHeader();
  if (serverCookie && !headers.has("cookie")) {
    headers.set("cookie", serverCookie);
  }
  return fetch(`${API_BASE}${path}`, { credentials: "include", ...init, headers });
}

let _refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      // /auth/refresh est exempté de CSRF côté serveur (protégé par le cookie
      // refresh HttpOnly). Pas besoin de jongler avec le token CSRF ici.
      const res = await rawRequest("/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

// Cache partagé des GET : aucune re-fetch tant que rien n'a changé.
// Invalidé automatiquement sur : 401, logout, toute mutation, ou manuellement.
// Ça tue le "polling" apparent quand plusieurs routes ont un beforeLoad qui
// appelle le même endpoint (ex: /me dans dashboard, settings, index).
const getCache = new Map<string, Promise<unknown>>();

export function invalidateGetCache(path?: string): void {
  if (path) getCache.delete(path);
  else getCache.clear();
}

async function apiFetchCore<T>(
  path: string,
  method: Method,
  body: unknown,
  extraHeaders: Record<string, string>,
  retried: boolean,
): Promise<T> {
  const isMutating = method !== "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (isMutating) {
    const token = await getCsrfToken();
    headers["x-csrf-token"] = token;
    invalidateGetCache();
  }

  const res = await rawRequest(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh sur 401 (hors /auth/* pour éviter les boucles).
  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    invalidateGetCache();
    const refreshed = await refreshSession();
    if (refreshed) return apiFetchCore<T>(path, method, body, extraHeaders, true);
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json();

  if (!res.ok) {
    const errData = data as { error?: { code?: string; message?: string } };
    throw new ApiError(
      res.status,
      errData.error?.code ?? "UNKNOWN",
      errData.error?.message ?? "An error occurred",
    );
  }
  return data as T;
}

export async function apiFetch<T = unknown>(
  path: string,
  { method = "GET", body, headers: extraHeaders = {} }: ApiRequestInit = {},
): Promise<T> {
  // GET : renvoie la même promesse partagée tant qu'elle n'a pas été invalidée.
  if (method === "GET") {
    const cached = getCache.get(path);
    if (cached) return cached as Promise<T>;
    const promise = apiFetchCore<T>(path, method, body, extraHeaders, false).catch((err) => {
      // Sur erreur, retire du cache — le prochain appel refera un vrai fetch.
      getCache.delete(path);
      throw err;
    });
    getCache.set(path, promise);
    return promise;
  }
  return apiFetchCore<T>(path, method, body, extraHeaders, false);
}
