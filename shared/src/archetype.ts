export type Archetype = 'warrior' | 'magician' | 'bowman' | 'thief' | 'pirate' | 'xenon' | 'unknown';

const TABLE: Record<Exclude<Archetype, 'unknown'>, string[]> = {
  warrior: ['Hero', 'Paladin', 'Dark Knight', 'Dawn Warrior', 'Mihile', 'Aran', 'Demon Slayer', 'Demon Avenger', 'Blaster', 'Kaiser', 'Hayato', 'Zero', 'Adele'],
  magician: ['Arch Mage (Fire, Poison)', 'Arch Mage (Ice, Lightning)', 'Bishop', 'Blaze Wizard', 'Evan', 'Luminous', 'Battle Mage', 'Kanna', 'Kinesis', 'Illium', 'Lara', 'Beast Tamer', 'Lynn'],
  bowman: ['Bowmaster', 'Marksman', 'Pathfinder', 'Wind Archer', 'Mercedes', 'Wild Hunter', 'Kain'],
  thief: ['Night Lord', 'Shadower', 'Blade Master', 'Dual Blade', 'Night Walker', 'Phantom', 'Cadena', 'Hoyoung', 'Khali'],
  pirate: ['Buccaneer', 'Corsair', 'Cannoneer', 'Cannon Master', 'Thunder Breaker', 'Mechanic', 'Angelic Buster', 'Shade', 'Jett', 'Ark', 'Mo Xuan'],
  xenon: ['Xenon'],
};

const norm = (s: string) => s.trim().toLowerCase();

const LOOKUP = new Map<string, Archetype>(
  (Object.entries(TABLE) as [Archetype, string[]][]).flatMap(([arch, names]) =>
    names.map((n) => [norm(n), arch] as [string, Archetype]),
  ),
);

export function classToArchetype(jobName: string): Archetype {
  return LOOKUP.get(norm(jobName)) ?? 'unknown';
}
