import type { BossDTO } from '@pf/shared';

const bundledIcons = new Set([
  'zakum',
  'magnus',
  'hilla',
  'pink-bean',
  'cygnus',
  'pierre',
  'von-bon',
  'crimson-queen',
  'vellum',
  'papulatus',
  'lotus',
  'damien',
  'guardian-angel-slime',
  'lucid',
  'will',
  'gloom',
  'verus-hilla',
  'darknell',
  'black-mage',
  'chosen-seren',
  'kalos-the-guardian',
  'kaling',
  'first-adversary',
  'limbo',
  'baldrix',
]);

export function bossIconUrl(boss: Pick<BossDTO, 'name' | 'imageUrl'>): string | undefined {
  if (boss.imageUrl) return boss.imageUrl;
  const slug = boss.name.trim().toLowerCase().replace(/\s+/g, '-');
  return bundledIcons.has(slug) ? `/boss-icons/${slug}.png` : undefined;
}
