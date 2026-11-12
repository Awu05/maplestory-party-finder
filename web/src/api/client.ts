export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Extra fields the server sent beside code and message (e.g. `igns`). */
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  const res = await fetch(path, { ...rest, body, headers: finalHeaders, credentials: 'include' });
  if (!res.ok) {
    let code = 'unknown';
    let message = res.statusText || 'Request failed';
    let details: Record<string, unknown> = {};
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
        const { code: _c, message: _m, ...rest } = data.error;
        details = rest;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
