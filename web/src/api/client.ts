export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
