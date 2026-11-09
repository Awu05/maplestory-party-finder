import { useState } from 'react';

type Mutations = Record<string, { error: Error | null }>;

/** The error of the most recently triggered action only, so a later success clears an earlier failure. */
export function useLastActionError(mutations: Mutations) {
  const [last, setLast] = useState<string | null>(null);
  const run = (name: string, fn: () => void) => {
    setLast(name);
    fn();
  };
  return { error: last ? (mutations[last]?.error ?? null) : null, run };
}
