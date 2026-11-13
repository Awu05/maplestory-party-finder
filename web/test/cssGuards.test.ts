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

describe('chip styles live in chips.css', () => {
  const chipSelectors = (css: string) =>
    selectors(css)
      .flatMap((l) => l.split(','))
      .map((s) => s.trim())
      .filter((s) => /\.chip\b/.test(s));

  it('global.css defines no .chip rules', () => {
    expect(chipSelectors(globalCss)).toEqual([]);
  });

  it('chips.css has the base, hover and pressed/checked rules', () => {
    expect(ruleBody(chipsCss, '.chip')).toMatch(/border-radius:\s*999px/);
    expect(ruleBody(chipsCss, '.chip:hover:not(:disabled)')).toMatch(/border-color:\s*var\(--accent\)/);
    const on = chipSelectors(chipsCss);
    expect(on).toEqual(expect.arrayContaining([".chip[aria-pressed='true']", ".chip[aria-checked='true']"]));
  });

  it('main.tsx imports chips.css globally, for .chip markup outside the Chips component', () => {
    expect(read('main.tsx')).toMatch(/import '\.\/components\/ui\/chips\.css';/);
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

  it('.visually-hidden lives in global.css; the phone .user-name rule mirrors it exactly', () => {
    const decls = (body: string) =>
      body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(';')
        .map((d) => d.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .sort();
    const hidden = decls(ruleBody(globalCss, '.visually-hidden'));
    expect(hidden).toContain('clip-path: inset(50%)');
    expect(selectors(postCss)).not.toContain('.visually-hidden');
    const phone = globalCss.slice(globalCss.indexOf('@media (max-width: 640px)'));
    expect(decls(ruleBody(phone, '.user-name'))).toEqual(hidden);
  });
});

describe('action group spacing', () => {
  it('stacked .actions rows and the viewer actions below them get --space-3', () => {
    expect(ruleBody(globalCss, '.actions + .actions')).toMatch(/margin-top:\s*var\(--space-3\)/);
    expect(ruleBody(postCss, '.actions + .viewer-actions')).toMatch(/margin-top:\s*var\(--space-3\)/);
  });
});

describe('free-time grid tap targets', () => {
  it('cells are at least 24px (1.5rem) tall on phones', () => {
    const css = read('components/post/FreeTimeGrid.css');
    const phone = /@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(ruleBody(phone, '.ftg__cell')).toMatch(/height:\s*1\.5rem/);
  });
});

describe('finalize dialog styles', () => {
  it('uses its own classes from post.css, not the move-world dialog ones', () => {
    const dialog = read('components/post/FinalizeTimeDialog.tsx');
    expect(dialog).not.toContain('move-dialog');
    expect(dialog).not.toContain('character.css');
    for (const sel of ['.finalize-dialog', '.finalize-dialog__content', '.finalize-dialog__field']) expect(selectors(postCss)).toContain(sel);
  });
});

describe('admin characters grid', () => {
  const adminCss = read('pages/admin/admin.css');
  it('.admin__chars is a grid whose columns are bounded, and each .admin__char fills its column', () => {
    expect(ruleBody(adminCss, '.admin__chars')).toMatch(/display:\s*grid/);
    expect(ruleBody(adminCss, '.admin__chars')).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(200px,\s*220px\)\)/);
    expect(ruleBody(adminCss, '.admin__char')).toMatch(/min-width:\s*0/);
    expect(ruleBody(adminCss, '.admin__char')).not.toMatch(/justify-items:\s*start/);
    expect(ruleBody(adminCss, '.admin__char .card')).toMatch(/width:\s*100%/);
    const phone = adminCss.slice(adminCss.indexOf('@media (max-width: 640px)', adminCss.indexOf('.admin__char .card')));
    expect(ruleBody(phone, '.admin__chars')).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });
});

