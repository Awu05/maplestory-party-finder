import { describe, expect, it } from 'vitest';
import { loadConfig, withUtcSession } from '../src/config.js';
import { buildTestApp, testConfig } from './helpers.js';

const base = { SESSION_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgresql://x' };

describe('SMTP configuration', () => {
  it('disables reset email until configured and chooses secure SMTP defaults', () => {
    expect(loadConfig(base).smtp).toBeUndefined();
    expect(loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'pf@example.com' }).smtp).toMatchObject({ port: 587, secure: false });
    expect(loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'pf@example.com', SMTP_SECURE: 'true' }).smtp).toMatchObject({ port: 465, secure: true });
  });
  it.each([
    { SMTP_HOST: 'smtp.example.com' },
    { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'bad' },
    { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'pf@example.com', SMTP_USER: 'user' },
    { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'pf@example.com', SMTP_PORT: '0' },
    { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'pf@example.com', SMTP_SECURE: 'invalid' },
  ])('rejects incomplete or invalid SMTP settings (%j)', (smtp) => {
    expect(() => loadConfig({ ...base, ...smtp })).toThrow(/SMTP/);
  });
});

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

describe('loadConfig PORT', () => {
  it.each([undefined, '', '  '])('%j -> 3000', (v) => {
    expect(loadConfig({ ...base, PORT: v }).port).toBe(3000);
  });
  it.each([['1', 1], ['8080', 8080], ['65535', 65535], [' 3001 ', 3001]])('%j -> %i', (v, n) => {
    expect(loadConfig({ ...base, PORT: v }).port).toBe(n);
  });
  it.each(['abc', '0', '70000', '65536', '-1', '3000.5', '1e3', '0x50', '80abc'])('%j throws a config error', (v) => {
    expect(() => loadConfig({ ...base, PORT: v })).toThrow(/PORT must be an integer from 1 to 65535/);
  });
});

describe('logger option', () => {
  it('loadConfig turns the logger on', () => {
    expect(loadConfig(base).logger).toBe(true);
  });

  it('the test app has no logger, whatever its port', async () => {
    const { app } = await buildTestApp({ config: testConfig({ port: 3000 }) });
    try {
      expect(testConfig().logger).toBe(false);
      expect(app.log.level).not.toBe('info');
    } finally {
      await app.close();
    }
  });

  it('config.logger true gives the app a logger', async () => {
    const { app } = await buildTestApp({ config: testConfig({ logger: true }) });
    try {
      expect(app.log.level).toBe('info');
    } finally {
      await app.close();
    }
  });
});

describe('withUtcSession', () => {
  it('adds a UTC session time zone to the connection URL', () => {
    const url = withUtcSession('postgresql://pf:p%40ss@db:5432/partyfinder');
    expect(new URL(url).searchParams.get('options')).toBe('-c TimeZone=UTC');
    expect(url).toContain('pf:p%40ss@db:5432/partyfinder');
  });

  it('keeps other query parameters and existing options', () => {
    const url = withUtcSession('postgresql://u:p@h/db?schema=public&options=-c%20statement_timeout%3D5000');
    const q = new URL(url).searchParams;
    expect(q.get('schema')).toBe('public');
    expect(q.get('options')).toBe('-c statement_timeout=5000 -c TimeZone=UTC');
  });

  it("leaves a URL alone when it already sets the session time zone", () => {
    const url = 'postgresql://u:p@h/db?options=-c%20TimeZone%3DUTC';
    expect(withUtcSession(url)).toBe(url);
  });
});
