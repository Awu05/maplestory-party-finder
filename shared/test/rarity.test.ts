import { describe, expect, it } from 'vitest';
import { rarityFor } from '../src/rarity';

const tiers = [
  { name: 'Common', minCp: 0, sortOrder: 0 },
  { name: 'Rare', minCp: 20_000_000, sortOrder: 1 },
  { name: 'Legendary', minCp: 400_000_000, sortOrder: 4 },
];

describe('rarityFor', () => {
  it('picks the highest qualifying tier', () => {
    expect(rarityFor(19_999_999, tiers)).toMatchObject({ tier: { name: 'Common' }, rank: 0, isTop: false });
    expect(rarityFor(20_000_000, tiers)).toMatchObject({ tier: { name: 'Rare' }, rank: 1 });
    expect(rarityFor(1_500_000_000, tiers)).toMatchObject({ tier: { name: 'Legendary' }, isTop: true });
  });
  it('returns null when nothing qualifies', () => {
    expect(rarityFor(5, [])).toBeNull();
    expect(rarityFor(5, [{ name: 'X', minCp: 10, sortOrder: 0 }])).toBeNull();
  });
  it('handles unsorted input without mutating it', () => {
    const shuffled = [tiers[2], tiers[0], tiers[1]];
    const copy = [...shuffled];
    expect(rarityFor(30_000_000, shuffled)).toMatchObject({ tier: { name: 'Rare' }, rank: 1 });
    expect(shuffled).toEqual(copy);
  });
});
