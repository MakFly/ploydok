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

export async function apiFetch<T = unknown>(
  path: string,
  { method = "GET", body, headers: extraHeaders = {} }: ApiRequestInit = {},
): Promise<T> {
  const isMutating = method !== "GET";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (isMutating) {
    const token = await getCsrfToken();
    headers["x-csrf-token"] = token;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

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
