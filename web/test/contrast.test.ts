import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const globalCss = readFileSync(resolve(__dirname, '../src/styles/global.css'), 'utf8');
const cardCss = readFileSync(resolve(__dirname, '../src/components/card/card.css'), 'utf8');

function rootTokens(css: string): Record<string, string> {
  const block = /:root\s*\{([^}]*)\}/.exec(css);
  if (!block) throw new Error(':root block not found');
  const tokens: Record<string, string> = {};
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const t = rootTokens(globalCss);
const BUTTON_TEXT = '#0f1220';

describe('Midnight contrast (WCAG AA 4.5:1)', () => {
  it.each([
    ['--text', '--bg'],
    ['--text', '--surface'],
    ['--text', '--surface-2'],
    ['--muted', '--bg'],
    ['--muted', '--surface'],
    ['--muted', '--surface-2'],
    ['--accent', '--surface'],
    ['--danger', '--surface'],
  ])('%s on %s', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['--accent', '--accent-2'])('button text on gradient endpoint %s', (name) => {
    expect(ratio(BUTTON_TEXT, t[name])).toBeGreaterThanOrEqual(4.5);
  });

  it('is always dark', () => {
    expect(globalCss).not.toContain('prefers-color-scheme');
    expect(cardCss).not.toContain('prefers-color-scheme');
  });
});
