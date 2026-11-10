import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../http/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;

// Postgres's zone list only changes with a server upgrade: load it once per process.
let zones: Promise<Set<string>> | null = null;

function postgresZones(db: Db): Promise<Set<string>> {
  zones ??= db
    .$queryRaw<{ name: string }[]>`SELECT name FROM pg_timezone_names`
    .then((rows) => new Set(rows.map((r) => r.name)))
    .catch((e: unknown) => {
      zones = null; // retry on the next call rather than caching a failure
      throw e;
    });
  return zones;
}

/**
 * Throws 400 VALIDATION unless Postgres knows `zone`. Intl and Postgres ship separate zone data, and
 * a stored zone Postgres lacks would make every Free-at query (AT TIME ZONE) fail.
 */
export async function assertPostgresZone(db: Db, zone: string): Promise<void> {
  if (!(await postgresZones(db)).has(zone)) {
    throw new AppError(400, 'VALIDATION', 'freeTimesZone is not a supported time zone');
  }
}
