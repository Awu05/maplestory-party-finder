import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './testDatabaseUrl.js';

export default function setup(): void {
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execSync('npx prisma migrate deploy', {
    cwd: serverDir,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
  // The test database deliberately runs in a non-UTC zone (like a home server set to Eastern time), so
  // any query that silently depends on the database server's zone fails here instead of in production.
  execSync(`npx prisma db execute --stdin --url "${testDatabaseUrl()}"`, {
    cwd: serverDir,
    stdio: 'pipe',
    input: `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/New_York'); END $$;`,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
