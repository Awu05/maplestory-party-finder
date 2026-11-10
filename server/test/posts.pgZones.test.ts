import { afterAll, describe, expect, it } from 'vitest';
import { assertPostgresZone } from '../src/posts/pgZones.js';
import { prisma } from './helpers.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('assertPostgresZone', () => {
  it('accepts zones Postgres knows', async () => {
    for (const z of ['America/New_York', 'Asia/Kolkata', 'UTC', 'Australia/Lord_Howe']) await expect(assertPostgresZone(prisma, z)).resolves.toBeUndefined();
  });

  it('a zone Postgres lacks -> 400 VALIDATION, so it is never stored for AT TIME ZONE', async () => {
    await expect(assertPostgresZone(prisma, 'Mars/Olympus_Mons')).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
  });
});
