import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { localHoursToUtcHours } from '@pf/shared';
import type { CharacterDTO } from '@pf/shared';
import { CharactersPage } from '../src/pages/CharactersPage';
import { CharacterFormPage } from '../src/pages/CharacterFormPage';
import { MyCharactersPage } from '../src/pages/MyCharactersPage';
import { PlayTimeGrid } from '../src/components/PlayTimeGrid';
import { mockApi, renderWithProviders } from './setup';

const character: CharacterDTO = {
  id: 'c1',
  ign: 'Lily',
  world: { id: 1, name: 'Kronos' },
  jobName: 'Bishop',
  level: 280,
  imageUrl: 'http://img/lily.png',
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null },
  screenshotUrl: null,
  note: 'Hello there',
  playTimes: [],
  bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard', experience: 'cleared' }],
  owner: { discordUsername: 'lily#1' },
  isOwner: true,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
};
const other = { ...character, id: 'c2', ign: 'Bob' };

const shared = {
  '/api/guilds': [
    { id: 'g1', name: 'Maple Guild', iconUrl: null, worldIds: [1], active: true },
    { id: 'g2', name: 'Other Guild', iconUrl: null, worldIds: [1], active: true },
  ],
  '/api/worlds': [{ id: 1, nexonWorldId: 45, name: 'Kronos', worldType: 'heroic', active: true }],
  '/api/rarity-tiers': [],
  '/api/bosses': [
    {
      id: 1,
      name: 'Lucid',
      imageUrl: null,
      difficulties: [
        { id: 6, difficulty: 'Normal', partyCap: 3 },
        { id: 7, difficulty: 'Hard', partyCap: 3 },
      ],
    },
  ],
};

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe('CharactersPage', () => {
  it('renders cards and filtering by guild refetches with ?guildId=', async () => {
    const fetchMock = mockApi({
      ...shared,
      '/api/characters': [character, other],
      '/api/characters?guildId=g2': [other],
    });
    renderWithProviders(<CharactersPage />);
    expect(await screen.findByLabelText(/Lily, level/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Bob, level/)).toBeInTheDocument();

    fireEvent.change(await screen.findByRole('option', { name: 'Other Guild' }).then((o) => o.parentElement!), {
      target: { value: 'g2' },
    });
    await waitFor(() => expect(screen.queryByLabelText(/Lily, level/)).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/characters?guildId=g2');
  });

  it('debounces the IGN search by 300ms', async () => {
    const fetchMock = mockApi({ ...shared, '/api/characters': [character], '/api/characters?q=Li': [character] });
    renderWithProviders(<CharactersPage />);
    await screen.findByLabelText(/Lily, level/);
    fireEvent.change(screen.getByLabelText('Search IGN'), { target: { value: 'Li' } });
    const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls()).not.toContain('/api/characters?q=Li');
    await waitFor(() => expect(urls()).toContain('/api/characters?q=Li'));
  });

  it('opens the detail modal when a card is clicked', async () => {
    mockApi({ ...shared, '/api/characters': [character] });
    renderWithProviders(<CharactersPage />);
    fireEvent.click(await screen.findByLabelText(/Lily, level/));
    expect(await screen.findByRole('heading', { name: 'Lily' })).toBeInTheDocument();
  });
});

describe('MyCharactersPage', () => {
  it('shows the login prompt when logged out', async () => {
    mockApi({ ...shared, '/api/auth/me': null, '/api/characters?mine=1': [] });
    renderWithProviders(<MyCharactersPage />);
    expect(await screen.findByText(/Log in with Discord to manage/)).toBeInTheDocument();
  });

  it('shows a TOO_SOON message on refresh and deletes after confirm', async () => {
    const fetchMock = mockApi({
      ...shared,
      '/api/auth/me': { id: 'u1', discordUsername: 'lily#1', avatarUrl: null, isAdmin: false },
      '/api/characters?mine=1': [character],
      'DELETE /api/characters/c1': undefined,
    });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === '/api/characters/c1/refresh'
        ? new Response(JSON.stringify({ error: { code: 'TOO_SOON', message: 'x' } }), { status: 429 })
        : base(input, init),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<MyCharactersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh from Nexon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refreshed recently');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'DELETE')).toBe(true),
    );
    expect(screen.getByRole('link', { name: 'Add character' })).toBeInTheDocument();
  });
});

function formRoutes() {
  return (
    <Routes>
      <Route path="/me/characters/new" element={<CharacterFormPage />} />
      <Route path="/me/characters/:id/edit" element={<CharacterFormPage />} />
      <Route path="/me/characters" element={<h1>My list</h1>} />
    </Routes>
  );
}

const preview = { ign: 'Lily', level: 280, jobName: 'Bishop', imageUrl: 'http://img/l.png', nexonWorldId: 45, worldName: 'Kronos' };

async function fillAddForm() {
  fireEvent.change(await screen.findByLabelText('In-game name'), { target: { value: 'Lily' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  fireEvent.click(await screen.findByRole('button', { name: /Lily.*Kronos/ }));
  fireEvent.change(await screen.findByLabelText('Combat power'), { target: { value: '1,500,000,000' } });
  fireEvent.change(screen.getByLabelText('Guild'), { target: { value: 'g1' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Hard Lucid' }));
  fireEvent.change(screen.getByLabelText('Experience for Hard Lucid'), { target: { value: 'can_carry' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sun 8p' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sun 9p' }));
}

describe('CharacterFormPage', () => {
  it('add flow posts the parsed values', async () => {
    const fetchMock = mockApi({
      ...shared,
      'POST /api/characters/lookup': [preview],
      'POST /api/characters': character,
    });
    renderWithProviders(formRoutes(), { route: '/me/characters/new' });
    await fillAddForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'My list' })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/characters' && (c[1] as RequestInit).method === 'POST')!;
    const body = bodyOf(post);
    expect(body.ign).toBe('Lily');
    expect(body.nexonWorldId).toBe(45);
    expect(body.combatPower).toBe(1500000000);
    expect(body.guildId).toBe('g1');
    expect(body.bosses).toEqual([{ bossDifficultyId: 7, experience: 'can_carry' }]);
    expect(body.playTimes).toEqual(
      localHoursToUtcHours([{ day: 0, hour: 20 }, { day: 0, hour: 21 }], new Date().getTimezoneOffset()),
    );
  });

  it('uploads the screenshot after create and surfaces an upload failure on the list page', async () => {
    const fetchMock = mockApi({
      ...shared,
      '/api/auth/me': { id: 'u1', discordUsername: 'lily#1', avatarUrl: null, isAdmin: false },
      '/api/characters?mine=1': [],
      'POST /api/characters/lookup': [preview],
      'POST /api/characters': character,
    });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === '/api/characters/c1/screenshot'
        ? new Response(JSON.stringify({ error: { code: 'BAD_FILE', message: 'Bad image' } }), { status: 400 })
        : base(input, init),
    );
    renderWithProviders(
      <Routes>
        <Route path="/me/characters/new" element={<CharacterFormPage />} />
        <Route path="/me/characters" element={<MyCharactersPage />} />
      </Routes>,
      { route: '/me/characters/new' },
    );
    await fillAddForm();
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Scouter screenshot'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('screenshot upload failed: Bad image');
  });

  it('disables an UNKNOWN_WORLD preview with the admin message', async () => {
    mockApi({ ...shared, 'POST /api/characters/lookup': [{ ...preview, worldName: null }] });
    renderWithProviders(formRoutes(), { route: '/me/characters/new' });
    fireEvent.change(await screen.findByLabelText('In-game name'), { target: { value: 'Lily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const card = await screen.findByRole('button', { name: /ask the admin/ });
    expect(card).toBeDisabled();
  });

  it('ALREADY_CLAIMED shows friendly message', async () => {
    const fetchMock = mockApi({ ...shared, 'POST /api/characters/lookup': [preview] });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input) === '/api/characters' && init?.method === 'POST'
        ? new Response(JSON.stringify({ error: { code: 'ALREADY_CLAIMED', message: 'raw' } }), { status: 409 })
        : base(input, init),
    );
    renderWithProviders(formRoutes(), { route: '/me/characters/new' });
    await fillAddForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This character is already claimed. Contact the admin if it's yours.",
    );
  });

  it('edit mode prefills CP and note and PATCHes', async () => {
    const fetchMock = mockApi({
      ...shared,
      '/api/characters/c1': character,
      'PATCH /api/characters/c1': character,
    });
    renderWithProviders(formRoutes(), { route: '/me/characters/c1/edit' });
    expect(await screen.findByLabelText('Combat power')).toHaveValue('1500000000');
    expect(screen.getByLabelText(/Note/)).toHaveValue('Hello there');
    expect(screen.getByText('11/300')).toBeInTheDocument();
    expect(screen.getByLabelText('Experience for Hard Lucid')).toHaveValue('cleared');
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'My list' });
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')!;
    expect(bodyOf(patch)).toMatchObject({ note: 'Updated', combatPower: 1500000000, guildId: 'g1' });
  });
});

describe('PlayTimeGrid (interactive)', () => {
  function Harness({ initial = [] as number[] }) {
    const [v, setV] = useState(initial);
    return <PlayTimeGrid value={v} onChange={setV} />;
  }
  const pressed = () =>
    screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'));

  it('click toggles a cell and a drag paints a range with the first cell\'s new state', () => {
    render(<Harness />);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Mon 1a' }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Mon 2a' }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Mon 3a' }));
    fireEvent.mouseUp(window);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Mon 4a' }));
    expect(pressed()).toEqual(['Mon 1a', 'Mon 2a', 'Mon 3a']);

    // Dragging from a selected cell deselects.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Mon 3a' }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Mon 2a' }));
    fireEvent.mouseUp(window);
    expect(pressed()).toEqual(['Mon 1a']);
  });

  it('keyboard activation (click without mouse) toggles', () => {
    render(<Harness />);
    const cell = screen.getByRole('button', { name: 'Tue 5p' });
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-pressed', 'false');
  });
});
