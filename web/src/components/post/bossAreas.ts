import type { BossDTO } from '@pf/shared';

// Broad area groups keep related bosses together without creating many one-boss sections.
const AREAS = [
  { name: 'Maple World', bosses: ['Zakum', 'Hilla', 'Pink Bean', 'Cygnus', 'Papulatus', 'Lotus', 'Damien', 'Guardian Angel Slime'] },
  { name: 'Root Abyss', bosses: ['Pierre', 'Von Bon', 'Crimson Queen', 'Vellum'] },
  { name: 'Arcane River', bosses: ['Lucid', 'Will'] },
  { name: 'Tenebris', bosses: ['Gloom', 'Verus Hilla', 'Darknell', 'Black Mage'] },
  { name: 'Grandis', bosses: ['Magnus', 'Chosen Seren', 'Kalos the Guardian', 'Kaling', 'First Adversary', 'Limbo', 'Baldrix'] },
] as const;

const areaByBoss = new Map<string, string>(AREAS.flatMap((area) => area.bosses.map((name) => [name.toLowerCase(), area.name] as const)));

export function groupBossesByArea(bosses: BossDTO[]): { name: string; bosses: BossDTO[] }[] {
  const groups = new Map<string, BossDTO[]>([...AREAS.map((area) => [area.name, []] as [string, BossDTO[]]), ['Other bosses', []]]);
  for (const boss of bosses) {
    const area = areaByBoss.get(boss.name.trim().toLowerCase()) ?? 'Other bosses';
    groups.get(area)!.push(boss);
  }
  return [...groups].filter(([, rows]) => rows.length > 0).map(([name, rows]) => ({ name, bosses: rows }));
}
