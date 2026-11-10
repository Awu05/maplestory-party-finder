import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CharacterDTO, RefreshResultDTO } from '@pf/shared';
import { MyCharactersPage } from '../src/pages/MyCharactersPage';
import { mockApi, renderWithProviders } from './setup';

const character: CharacterDTO = {
  id: 'c1',
  ign: 'SunOfSinz',
  world: { id: 9, name: 'Scania' },
  jobName: 'Bishop',
  archetype: 'magician',
  level: 280,
  imageUrl: 'http://i/s.png',
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: null,
  manual: true,
  screenshotUrl: null,
  owner: { discordUsername: 'lily#1' },
  isOwner: true,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
};

const kronos = { worldId: 1, worldName: 'Kronos', level: 280, jobName: 'Bishop', imageUrl: 'http://i/1.png' };
const hyperion = { worldId: 2, worldName: 'Hyperion', level: 270, jobName: 'Bishop', imageUrl: 'http://i/2.png' };

const base = {
  '/api/auth/me': { id: 'u1', discordUsername: 'lily#1', isAdmin: false },
  '/api/characters?mine=1': [character],
  '/api/rarity-tiers': [],
  '/api/guilds': [
    { id: 'g2', name: 'Zeta', iconUrl: null, worldIds: [1], active: true },
    { id: 'g1', name: 'Alpha', iconUrl: null, worldIds: [1], active: true },
    { id: 'g3', name: 'Dead', iconUrl: null, worldIds: [1], active: false },
  ],
};

const result = (outcome: RefreshResultDTO['outcome'], candidates: RefreshResultDTO['candidates'] = []): RefreshResultDTO => ({
  outcome,
  character,
  candidates,
});

async function refreshWith(r: RefreshResultDTO, extra: Record<string, unknown> = {}) {
  const fetchMock = mockApi({ ...base, 'POST /api/characters/c1/refresh': r, ...extra });
  renderWithProviders(<MyCharactersPage />);
  const btn = await screen.findByRole('button', { name: 'Refresh from Nexon' });
  fireEvent.click(btn);
  return { fetchMock, btn };
}

describe('refresh outcomes', () => {
  it.each([
    ['synced', 'Synced from Nexon'],
    ['stale', "Couldn't reach Nexon — showing last known data"],
    ['not_found', 'Still not found on Nexon'],
    ['unavailable', "Couldn't reach Nexon, try again later"],
  ] as const)('%s shows its message', async (outcome, text) => {
    await refreshWith(result(outcome));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe('MoveWorldDialog', () => {
  it('single candidate: opens modal dialog with prompt, guild select and buttons', async () => {
    await refreshWith(result('found_elsewhere', [kronos]));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('SunOfSinz was found on Kronos. Update your character to it?');
    await screen.findByRole('option', { name: 'Zeta' });
    const select = screen.getByLabelText('Guild (optional)') as HTMLSelectElement;
    expect(select.selectedOptions[0]).toHaveTextContent('No guild');
    expect([...select.options].map((o) => o.textContent)).toEqual(['No guild', 'Alpha', 'Zeta']);
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('two candidates: radio group, Update disabled until picked', async () => {
    await refreshWith(result('found_elsewhere', [kronos, hyperion]));
    await screen.findByRole('dialog');
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Hyperion/ }));
    expect(update).toBeEnabled();
  });

  it('Update posts /move and shows Moved to', async () => {
    const { fetchMock } = await refreshWith(result('found_elsewhere', [kronos]), {
      'POST /api/characters/c1/move': { ...character, world: { id: 1, name: 'Kronos' } },
    });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('Moved to Kronos')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/move'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ worldId: 1, guildId: null });
  });

  it('sends the picked guild', async () => {
    const { fetchMock } = await refreshWith(result('found_elsewhere', [kronos]), {
      'POST /api/characters/c1/move': { ...character, world: { id: 1, name: 'Kronos' } },
    });
    await screen.findByRole('dialog');
    await screen.findByRole('option', { name: 'Alpha' });
    fireEvent.change(screen.getByLabelText('Guild (optional)'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await screen.findByText('Moved to Kronos');
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/move'))!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ worldId: 1, guildId: 'g1' });
  });

  it('409 IN_PARTY keeps the dialog open with the server message', async () => {
    await refreshWith(result('found_elsewhere', [kronos]));
    await screen.findByRole('dialog');
    const orig = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/move')
        ? new Response(JSON.stringify({ error: { code: 'IN_PARTY', message: 'Leave or close your open parties first' } }), {
            status: 409,
          })
        : orig(input, init),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByText('Leave or close your open parties first')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Not now closes without a request and returns focus to Refresh', async () => {
    const { fetchMock, btn } = await refreshWith(result('found_elsewhere', [kronos]));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/move'))).toBe(false);
    expect(btn).toHaveFocus();
  });

  it('Escape closes and returns focus to Refresh', async () => {
    const { fetchMock, btn } = await refreshWith(result('found_elsewhere', [kronos]));
    const dialog = await screen.findByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/move'))).toBe(false);
    expect(btn).toHaveFocus();
  });
});
