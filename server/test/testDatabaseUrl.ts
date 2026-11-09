import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const FALLBACK = 'postgresql://pf:pf@localhost:5432/partyfinder_test';

/** DATABASE_URL from server/.env.test, or the docker-compose default if the file is absent. */
export function testDatabaseUrl(): string {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.test');
  try {
    return parse(fs.readFileSync(file))['DATABASE_URL'] || FALLBACK;
  } catch {
    return FALLBACK;
  }
}
