import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../src', p), 'utf8');
const globalCss = read('styles/global.css');
const chipsCss = read('components/ui/chips.css');
const postCss = read('components/post/post.css');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const srcFiles = walk(resolve(__dirname, '../src'));
const tsx = srcFiles.filter((f) => f.endsWith('.tsx'));

/** Selector lists of every rule (comments stripped, at-rule preludes skipped). */
function selectors(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
}
function ruleBody(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}
/** Removes `:where(...)` groups, including nested parentheses. */
function stripWhere(sel: string): string {
  let out = sel;
  for (let i = out.indexOf(':where('); i !== -1; i = out.indexOf(':where(')) {
    let depth = 0;
    let j = i + ':where'.length;
    for (; j < out.length; j++) {
      if (out[j] === '(') depth++;
      else if (out[j] === ')' && --depth === 0) break;
    }
    out = out.slice(0, i) + out.slice(j + 1);
  }
  return out;
}

describe('global button rules', () => {
  it('bare button selectors carry zero specificity so component state styles win', () => {
    const offenders = selectors(globalCss)
      .flatMap((list) => list.split(','))
      .map((s) => s.trim())
      .filter((s) => /(^|[\s>+~])button\b/.test(stripWhere(s)));
    expect(offenders).toEqual([]);
  });

  it('the generic hover rule is wrapped in :where()', () => {
    expect(selectors(globalCss).some((s) => s.includes(':where(button:hover:not(:disabled))'))).toBe(true);
  });
});

describe('MenuChip keyboard position', () => {
  it('the active option has a visible accent indicator', () => {
    expect(ruleBody(chipsCss, '.menu-chip-option.is-active')).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('the listbox keeps a visible focus ring', () => {
    const body = ruleBody(chipsCss, '.menu-chip-list:focus-visible');
    expect(body).not.toMatch(/outline:\s*none/);
    expect(body).toMatch(/outline:\s*2px solid/);
  });
});

describe('button API', () => {
  it('no legacy .button class in markup', () => {
    expect(tsx.filter((f) => /className="button"/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('no .button alias rules in global.css', () => {
    const offenders = selectors(globalCss)
      .flatMap((list) => list.split(','))
      .filter((s) => /\.button\b/.test(s));
    expect(offenders).toEqual([]);
  });

  it('page buttons name their variant explicitly', () => {
    const offenders = tsx
      .filter((f) => f.includes(`${join('src', 'pages')}`))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/<button\b((?:=>|[^>])*)>/g)]
          .filter((m) => !/className=/.test(m[1]))
          .map((m) => `${f}: ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`),
      );
    expect(offenders).toEqual([]);
  });
});

describe('dead CSS and stray values', () => {
  it.each(['.page', '.post-grid'])('%s is not defined', (cls) => {
    const all = [globalCss, postCss].flatMap((c) => selectors(c)).flatMap((l) => l.split(',')).map((x) => x.trim());
    expect(all).not.toContain(cls);
  });

  it('no className="full" leftovers', () => {
    expect(tsx.filter((f) => /className="full"/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('.post-card__slots is styled', () => {
    expect(selectors(postCss).some((s) => s.includes('.post-card__slots'))).toBe(true);
  });

  it('post.css uses only the 640px breakpoint', () => {
    const widths = [...postCss.matchAll(/max-width:\s*(\d+)px\)/g)].map((m) => m[1]);
    expect(widths.filter((w) => w !== '640')).toEqual([]);
  });

  it('.visually-hidden lives in global.css and is not re-implemented', () => {
    expect(ruleBody(globalCss, '.visually-hidden')).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(selectors(postCss)).not.toContain('.visually-hidden');
    const phone = globalCss.slice(globalCss.indexOf('@media (max-width: 640px)'));
    expect(ruleBody(phone, '.user-name')).not.toMatch(/clip-path/);
  });
});

describe('action group spacing', () => {
  it('stacked .actions rows and the viewer actions below them get --space-3', () => {
    expect(ruleBody(globalCss, '.actions + .actions')).toMatch(/margin-top:\s*var\(--space-3\)/);
    expect(ruleBody(postCss, '.actions + .viewer-actions')).toMatch(/margin-top:\s*var\(--space-3\)/);
  });
});
