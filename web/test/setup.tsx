import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, vi } from 'vitest';

// jsdom has no HTMLDialogElement#showModal/close; minimal stand-ins toggle the `open` attribute.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Handler = unknown | ((init?: RequestInit) => unknown);

/** Stubs fetch. Keys are "/path" (any method) or "METHOD /path"; values are JSON bodies or functions. */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = [`${method} ${url}`, url].find((k) => k in routes);
    if (!key) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: `No mock for ${method} ${url}` } }), {
        status: 404,
      });
    }
    const h = routes[key];
    const body = typeof h === 'function' ? (h as (i?: RequestInit) => unknown)(init) : h;
    if (body === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
