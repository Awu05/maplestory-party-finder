import { ApiError } from './client';

const FRIENDLY: Record<string, string> = {
  ALREADY_CLAIMED: "This character is already claimed. Contact the admin if it's yours.",
  NEXON_UNAVAILABLE: "Couldn't reach Nexon. Try again in a minute.",
  TOO_SOON: 'Refreshed recently. Try again in a few minutes.',
};

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  return err instanceof Error ? err.message : 'Something went wrong.';
}
