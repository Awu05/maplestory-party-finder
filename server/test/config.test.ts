import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { SESSION_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgresql://x' };

describe('loadConfig JOBS_ENABLED', () => {
  it('defaults to true', () => {
    expect(loadConfig(base).jobsEnabled).toBe(true);
  });
  it.each(['false', 'FALSE', 'False', '0'])('%s disables', (v) => {
    expect(loadConfig({ ...base, JOBS_ENABLED: v }).jobsEnabled).toBe(false);
  });
  it.each(['true', '1', '', 'yes'])('%j enables', (v) => {
    expect(loadConfig({ ...base, JOBS_ENABLED: v }).jobsEnabled).toBe(true);
  });
});
