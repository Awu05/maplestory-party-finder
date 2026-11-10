import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OLD_PALETTE = [
  '#fff8ec', '#fbe3b5', '#3b2a1a', '#7a6650', '#e6d5b8', '#c2570c', '#1c1610',
  '#2a2118', '#f3e6d0', '#b49e80', '#4a3b2a', '#f08a3c', '#33261a',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(resolve(__dirname, '../src')).filter((f) => /\.(css|tsx|ts)$/.test(f));

describe('old palette guard', () => {
  it('scans source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(OLD_PALETTE)('%s does not appear in web/src', (hex) => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').toLowerCase().includes(hex));
    expect(offenders).toEqual([]);
  });
});
