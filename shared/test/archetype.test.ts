import { describe, expect, it } from 'vitest';
import { classToArchetype } from '../src/archetype';

describe('classToArchetype', () => {
  it('maps known classes', () => {
    expect(classToArchetype('Angelic Buster')).toBe('pirate');
    expect(classToArchetype('Xenon')).toBe('xenon');
    expect(classToArchetype('Hero')).toBe('warrior');
    expect(classToArchetype('Kain')).toBe('bowman');
    expect(classToArchetype('Khali')).toBe('thief');
  });
  it('trims and ignores case', () => {
    expect(classToArchetype('  arch mage (ice, lightning) ')).toBe('magician');
  });
  it('returns unknown for unrecognised classes', () => {
    expect(classToArchetype('Brand New Class')).toBe('unknown');
    expect(classToArchetype('Arch Mage')).toBe('unknown');
  });
});
