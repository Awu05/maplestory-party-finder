export type Archetype = 'warrior' | 'magician' | 'bowman' | 'thief' | 'pirate' | 'xenon' | 'unknown';

export const CLASS_CATEGORIES = ["Explorers","Cygnus Knights","Heroes","Resistance","Nova","Sengoku","Flora","Anima","Demon","Jianghu","Shine","Other"] as const;
export type ClassCategory = typeof CLASS_CATEGORIES[number];

type KnownClass = { name: string; archetype: Exclude<Archetype, 'unknown'>; category: ClassCategory };

// https://grandislibrary.com/classes (2026-11-11)
const GROUPS: { category: ClassCategory; classes: [string, KnownClass['archetype']][] }[] = [
  { category: 'Explorers', classes: [
    ['Hero', 'warrior'],
    ['Paladin', 'warrior'],
    ['Dark Knight', 'warrior'],
    ['Bishop', 'magician'],
    ['Arch Mage (Ice, Lightning)', 'magician'],
    ['Arch Mage (Fire, Poison)', 'magician'],
    ['Dual Blade', 'thief'],
    ['Shadower', 'thief'],
    ['Night Lord', 'thief'],
    ['Pathfinder', 'bowman'],
    ['Marksman', 'bowman'],
    ['Bowmaster', 'bowman'],
    ['Cannoneer', 'pirate'],
    ['Buccaneer', 'pirate'],
    ['Corsair', 'pirate'],
  ] },
  { category: 'Cygnus Knights', classes: [
    ['Dawn Warrior', 'warrior'],
    ['Thunder Breaker', 'pirate'],
    ['Night Walker', 'thief'],
    ['Wind Archer', 'bowman'],
    ['Blaze Wizard', 'magician'],
    ['Mihile', 'warrior'],
  ] },
  { category: 'Heroes', classes: [
    ['Mercedes', 'bowman'],
    ['Aran', 'warrior'],
    ['Phantom', 'thief'],
    ['Luminous', 'magician'],
    ['Evan', 'magician'],
    ['Shade', 'pirate'],
  ] },
  { category: 'Resistance', classes: [
    ['Battle Mage', 'magician'],
    ['Blaster', 'warrior'],
    ['Mechanic', 'pirate'],
    ['Wild Hunter', 'bowman'],
    ['Xenon', 'xenon'],
    ['Demon Slayer', 'warrior'],
    ['Demon Avenger', 'warrior'],
  ] },
  { category: 'Nova', classes: [
    ['Angelic Buster', 'pirate'],
    ['Kaiser', 'warrior'],
    ['Cadena', 'thief'],
    ['Kain', 'bowman'],
  ] },
  { category: 'Sengoku', classes: [
    ['Kanna', 'magician'],
    ['Hayato', 'warrior'],
  ] },
  { category: 'Flora', classes: [
    ['Adele', 'warrior'],
    ['Ark', 'pirate'],
    ['Illium', 'magician'],
    ['Khali', 'thief'],
  ] },
  { category: 'Anima', classes: [
    ['Hoyoung', 'thief'],
    ['Lara', 'magician'],
    ['Ren', 'warrior'],
  ] },
  { category: 'Demon', classes: [
    ['Lethe', 'magician'],
  ] },
  { category: 'Jianghu', classes: [
    ['Lynn', 'magician'],
    ['Mo Xuan', 'pirate'],
  ] },
  { category: 'Shine', classes: [
    ['Sia Astelle', 'magician'],
    ['Erel Light', 'warrior'],
  ] },
  { category: 'Other', classes: [
    ['Kinesis', 'magician'],
    ['Zero', 'warrior'],
  ] },
];

export const KNOWN_CLASSES: KnownClass[] = GROUPS.flatMap(({ category, classes }) => classes.map(([name, archetype]) => ({ name, archetype, category })));

const norm = (name: string) => name.trim().toLowerCase();
const LOOKUP = new Map<string, Archetype>(KNOWN_CLASSES.map(({ name, archetype }) => [norm(name), archetype]));
for (const [name, archetype] of [['Blade Master', 'thief'], ['Cannon Master', 'pirate'], ['Beast Tamer', 'magician'], ['Jett', 'pirate']] as const) LOOKUP.set(norm(name), archetype);

export function classToArchetype(jobName: string): Archetype {
  return LOOKUP.get(norm(jobName)) ?? 'unknown';
}

export function groupClasses<T extends { name: string; category?: ClassCategory }>(classes: T[]): { category: ClassCategory; classes: T[] }[] {
  return CLASS_CATEGORIES.map((category) => ({
    category,
    classes: classes.filter((job) => (job.category ?? 'Other') === category).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
  })).filter((group) => group.classes.length > 0);
}
