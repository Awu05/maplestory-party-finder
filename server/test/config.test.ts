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

describe('loadConfig TRUST_PROXY', () => {
  it('defaults to one proxy hop for an https WEB_ORIGIN and off otherwise', () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, WEB_ORIGIN: 'http://localhost:3000' }).trustProxy).toBe(false);
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://pf.example.com' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://pf.example.com', TRUST_PROXY: ' ' }).trustProxy).toBe(1);
  });
  it.each([
    ['false', false], ['FALSE', false], ['true', true], [' True ', true], ['1', 1], ['2', 2],
    ['127.0.0.1', ['127.0.0.1']], ['10.0.0.0/8, 172.16.0.0/12,::1', ['10.0.0.0/8', '172.16.0.0/12', '::1']], ['fd00::/8', ['fd00::/8']],
  ] as const)('%j -> %j', (v, expected) => {
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://pf.example.com', TRUST_PROXY: v }).trustProxy).toEqual(expected);
  });
  it.each(['0', '-1', '1.5', 'yes', 'proxy.example.com', '10.0.0.0/33', '::1/129', '10.0.0.1,', '300.0.0.1', '10.0.0.0/'])('%j throws a config error', (v) => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: v })).toThrow(/TRUST_PROXY/);
  });
});

describe('trustProxy in the app', () => {
  const forgot = (app: Awaited<ReturnType<typeof buildTestApp>>['app'], forwardedFor: string) => app.inject({
    method: 'POST', url: '/api/auth/password/forgot', remoteAddress: '10.0.0.5',
    headers: { origin: 'http://localhost:5173', 'x-forwarded-for': forwardedFor }, payload: { email: 'maple@example.com' },
  });

  it('counts clients behind a trusted proxy in separate per-IP buckets', async () => {
    const { app } = await buildTestApp({ config: testConfig({ trustProxy: 1 }) });
    try {
      // The forgot-password guard allows 10 requests per IP per window (503 here: no mailer configured).
      for (let i = 0; i < 10; i++) expect((await forgot(app, '203.0.113.1')).statusCode).toBe(503);
      expect((await forgot(app, '203.0.113.1')).statusCode).toBe(429);
      // One trusted hop: only the address our proxy appended counts, not entries a client prepended.
      expect((await forgot(app, '198.51.100.1, 203.0.113.1')).statusCode).toBe(429);
      expect((await forgot(app, '203.0.113.2')).statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('ignores X-Forwarded-For without a trusted proxy, so spoofed values share one bucket', async () => {
    const { app } = await buildTestApp({ config: testConfig({ trustProxy: false }) });
    try {
      for (let i = 0; i < 10; i++) expect((await forgot(app, `203.0.113.${i + 1}`)).statusCode).toBe(503);
      expect((await forgot(app, '203.0.113.99')).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
