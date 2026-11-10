import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CharacterDTO, RarityTierDTO } from '@pf/shared';
import { afterEach, vi } from 'vitest';
import { formatCp } from '../src/components/card/format';
import { CharacterCard } from '../src/components/card/CharacterCard';
import { CardDetailModal } from '../src/components/card/CardDetailModal';

const tiers: RarityTierDTO[] = [
  { id: 1, name: 'Common', minCp: 0, sortOrder: 0 },
  { id: 2, name: 'Rare', minCp: 20_000_000, sortOrder: 1 },
  { id: 3, name: 'Legendary', minCp: 400_000_000, sortOrder: 2 },
];

function makeCharacter(overrides: Partial<CharacterDTO> = {}): CharacterDTO {
  return {
    id: 'c1',
    ign: 'Lily',
    world: { id: 1, name: 'Kronos' },
    jobName: 'Angelic Buster', archetype: 'pirate',
    level: 279,
    imageUrl: 'https://example.com/lily.png',
    combatPower: 1_500_000_000,
    cpUpdatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    guild: { id: 'g1', name: 'Mapleholics', iconUrl: null },
    screenshotUrl: '/uploads/lily.png',
    owner: { discordUsername: 'maple_fan' },
    isOwner: false,
    syncStatus: 'ok',
    lastSyncedAt: new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatCp', () => {
  it.each([
    [1_500_000_000, '1.5B'],
    [12_345_678, '12.3M'],
    [950_000, '950K'],
    [999, '999'],
  ])('%d -> %s', (n, expected) => {
    expect(formatCp(n)).toBe(expected);
  });
});

describe('CharacterCard', () => {
  it('card applies archetype and foil classes', () => {
    render(<CharacterCard character={makeCharacter()} tiers={tiers} onOpen={() => {}} />);
    const card = screen.getByRole('button', { name: 'Lily, level 279 Angelic Buster' });
    expect(card).toHaveClass('card', 'card--pirate', 'card--rank-2', 'card--foil');
    expect(within(card).getByText('1.5B')).toBeInTheDocument();
    expect(within(card).getByText('Lv. 279')).toBeInTheDocument();
    expect(within(card).getByText('Legendary')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Lily' })).toHaveAttribute('src', 'https://example.com/lily.png');
    expect(within(card).getByText('maple_fan')).toBeInTheDocument();
    expect(within(card).getByText('Mapleholics')).toBeInTheDocument();
    expect(within(card).getByText('Kronos')).toBeInTheDocument();
  });

  it('lower rank is not foil', () => {
    render(<CharacterCard character={makeCharacter({ combatPower: 25_000_000 })} tiers={tiers} onOpen={() => {}} />);
    const card = screen.getByRole('button');
    expect(card).toHaveClass('card--rank-1');
    expect(card).not.toHaveClass('card--foil');
  });

  it('rank >= 3 gets card--rank-high regardless of tier count; lower ranks do not', () => {
    const many: RarityTierDTO[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      name: `Tier ${i}`,
      minCp: i * 1_000_000,
      sortOrder: i,
    }));
    const { rerender } = render(
      <CharacterCard character={makeCharacter({ combatPower: 10_500_000 })} tiers={many} onOpen={() => {}} />,
    );
    const card = screen.getByRole('button');
    expect(card).toHaveClass('card--rank-10', 'card--rank-high');
    expect(card).not.toHaveClass('card--foil');

    rerender(<CharacterCard character={makeCharacter({ combatPower: 2_500_000 })} tiers={many} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('card--rank-2');
    expect(screen.getByRole('button')).not.toHaveClass('card--rank-high');
  });

  it('xenon gets card--xenon', () => {
    render(<CharacterCard character={makeCharacter({ jobName: 'Xenon', archetype: 'xenon' })} tiers={tiers} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('card--xenon');
  });

  it('unknown class gets card--unknown', () => {
    render(<CharacterCard character={makeCharacter({ jobName: 'Mystery Job', archetype: 'unknown' })} tiers={tiers} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveClass('card--unknown');
  });

  it('Enter opens', () => {
    const onOpen = vi.fn();
    render(<CharacterCard character={makeCharacter()} tiers={tiers} onOpen={onOpen} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Space and click open', () => {
    const onOpen = vi.fn();
    render(<CharacterCard character={makeCharacter()} tiers={tiers} onOpen={onOpen} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('CardDetailModal', () => {
  it('modal shows discord username, screenshot img, and no boss, play time or note sections; Edit only for owner', () => {
    const onEdit = vi.fn();
    const { rerender } = render(
      <CardDetailModal character={makeCharacter()} tiers={tiers} onClose={() => {}} onEdit={onEdit} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getAllByText('maple_fan').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Copy Discord username' })).toBeInTheDocument();
    const shot = within(dialog).getByRole('img', { name: 'Lily Scouter screenshot' });
    expect(shot).toHaveAttribute('src', '/uploads/lily.png');
    expect(shot.closest('a')).toHaveAttribute('target', '_blank');
    expect(within(dialog).getByText('CP updated 3 days ago')).toBeInTheDocument();
    for (const heading of ['Bosses', 'Note']) expect(within(dialog).queryByText(heading)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Play times/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    rerender(
      <CardDetailModal character={makeCharacter({ isOwner: true })} tiers={tiers} onClose={() => {}} onEdit={onEdit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('modal without screenshot shows placeholder', () => {
    render(<CardDetailModal character={makeCharacter({ screenshotUrl: null })} tiers={tiers} onClose={() => {}} />);
    expect(screen.getByText('No Scouter screenshot yet')).toBeInTheDocument();
  });

  it('modal stale notice', () => {
    const { rerender } = render(<CardDetailModal character={makeCharacter()} tiers={tiers} onClose={() => {}} />);
    expect(screen.queryByText("Stale: couldn't sync from Nexon")).not.toBeInTheDocument();
    rerender(<CardDetailModal character={makeCharacter({ syncStatus: 'stale' })} tiers={tiers} onClose={() => {}} />);
    expect(screen.getByText("Stale: couldn't sync from Nexon")).toBeInTheDocument();
  });

  it('closes on Esc (cancel) and backdrop click', () => {
    const onClose = vi.fn();
    render(<CardDetailModal character={makeCharacter()} tiers={tiers} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('heading', { name: 'Lily' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
