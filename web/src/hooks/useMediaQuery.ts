import { useEffect, useState } from 'react';

const query$ = (query: string): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

/** True while `query` matches. False when matchMedia is unavailable (SSR, older test environments). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => query$(query)?.matches ?? false);

  useEffect(() => {
    const mql = query$(query);
    if (!mql) return;
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The app's single phone breakpoint; CSS files use the same `@media (max-width: 640px)`. */
export const PHONE_QUERY = '(max-width: 640px)';

/** True on phone-width viewports. */
export const usePhone = (): boolean => useMediaQuery(PHONE_QUERY);
