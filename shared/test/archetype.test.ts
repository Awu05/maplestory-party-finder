import { describe, expect, it } from 'vitest';
import { classToArchetype, KNOWN_CLASSES } from '../src/archetype';

describe('classToArchetype', () => {
  it('maps known classes', () => {
    expect(classToArchetype('Angelic Buster')).toBe('pirate');
    expect(classToArchetype('Xenon')).toBe('xenon');
    expect(classToArchetype('Hero')).toBe('warrior');
    expect(classToArchetype('Kain')).toBe('bowman');
    expect(classToArchetype('Khali')).toBe('thief');
    expect(classToArchetype('Ren')).toBe('warrior');
    expect(classToArchetype('Lethe')).toBe('magician');
    expect(classToArchetype('Sia Astelle')).toBe('magician');
    expect(classToArchetype('Erel Light')).toBe('warrior');
  });
  it('keeps legacy Nexon names working without duplicate catalog choices', () => {
    expect(classToArchetype('Blade Master')).toBe('thief');
    expect(classToArchetype('Cannon Master')).toBe('pirate');
    expect(classToArchetype('Jett')).toBe('pirate');
    expect(classToArchetype('Beast Tamer')).toBe('magician');
    expect(KNOWN_CLASSES).toHaveLength(54);
    expect(new Set(KNOWN_CLASSES.map((job) => job.name)).size).toBe(54);
    expect(KNOWN_CLASSES.some((job) => job.name === 'Blade Master')).toBe(false);
  });
  it('trims and ignores case', () => {
    expect(classToArchetype('  arch mage (ice, lightning) ')).toBe('magician');
  });
  it('returns unknown for unrecognised classes', () => {
    expect(classToArchetype('Brand New Class')).toBe('unknown');
    expect(classToArchetype('Arch Mage')).toBe('unknown');
  });
});
