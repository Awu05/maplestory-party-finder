import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { CharacterDTO } from '@pf/shared';
import { CharactersPage } from '../src/pages/CharactersPage';
import { CharacterFormPage } from '../src/pages/CharacterFormPage';
import { MyCharactersPage } from '../src/pages/MyCharactersPage';
import { mockApi, renderWithProviders } from './setup';

const character: CharacterDTO = {
  id: 'c1',
  ign: 'Lily',
  world: { id: 1, name: 'Kronos' },
  jobName: 'Bishop', archetype: 'magician',
  level: 280,
  imageUrl: 'http://img/lily.png',
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null }, manual: false,
  screenshotUrl: null,
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

    fireEvent.click(await screen.findByRole('button', { name: 'Guild' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Other Guild' }));
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

  it.each([
    ['ok', 'Synced from Nexon'],
    ['stale', "Couldn't reach Nexon — showing last known data"],
  ] as const)('refresh returning syncStatus=%s shows "%s"', async (syncStatus, text) => {
    mockApi({
      ...shared,
      '/api/auth/me': { id: 'u1', discordUsername: 'lily#1', avatarUrl: null, isAdmin: false },
      '/api/characters?mine=1': [character],
      'POST /api/characters/c1/refresh': { outcome: syncStatus === 'ok' ? 'synced' : 'stale', candidates: [], character: { ...character, syncStatus } },
    });
    renderWithProviders(<MyCharactersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh from Nexon' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
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
    expect(Object.keys(body).sort()).toEqual(['combatPower', 'guildId', 'ign', 'nexonWorldId']);
  });

  it('the details form has only CP, guild and screenshot', async () => {
    mockApi({ ...shared, 'POST /api/characters/lookup': [preview] });
    renderWithProviders(formRoutes(), { route: '/me/characters/new' });
    await fillAddForm();
    expect(screen.getByLabelText('Combat power')).toBeInTheDocument();
    expect(screen.getByLabelText('Guild')).toBeInTheDocument();
    expect(screen.getByLabelText('Scouter screenshot')).toBeInTheDocument();
    for (const text of [/Bosses/, /Play times/, /Note/]) expect(screen.queryByText(text)).toBeNull();
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

  it('disables a preview whose world is inactive', async () => {
    // Known world (worldName set) but not in the active /api/worlds list.
    mockApi({ ...shared, 'POST /api/characters/lookup': [{ ...preview, nexonWorldId: 99, worldName: 'Retired' }] });
    renderWithProviders(formRoutes(), { route: '/me/characters/new' });
    fireEvent.change(await screen.findByLabelText('In-game name'), { target: { value: 'Lily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    const card = await screen.findByRole('button', { name: /isn't active/ });
    expect(card).toBeDisabled();
    expect(screen.queryByLabelText('Combat power')).not.toBeInTheDocument();
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

  it('edit mode prefills CP and guild and PATCHes', async () => {
    const fetchMock = mockApi({
      ...shared,
      '/api/characters/c1': character,
      'PATCH /api/characters/c1': character,
    });
    renderWithProviders(formRoutes(), { route: '/me/characters/c1/edit' });
    expect(await screen.findByLabelText('Combat power')).toHaveValue('1500000000');
    expect(screen.getByLabelText('Guild')).toHaveValue('g1');
    fireEvent.change(screen.getByLabelText('Combat power'), { target: { value: '1,600,000,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'My list' });
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')!;
    expect(bodyOf(patch)).toEqual({ combatPower: 1600000000, guildId: 'g1' });
  });

  describe('manual characters', () => {
    const classes = [
      { id: 3, name: 'bishop', archetype: 'magician' },
      { id: 1, name: 'Zero', archetype: 'warrior' },
      { id: 2, name: 'Adele', archetype: 'warrior' },
    ];
    const manualShared = { ...shared, '/api/classes': classes };
    const manualChar: CharacterDTO = { ...character, id: 'm1', manual: true, jobName: 'Retired Class', level: 200 };

    async function lookupEmpty(extra: Record<string, unknown> = {}) {
      const fetchMock = mockApi({ ...manualShared, 'POST /api/characters/lookup': [], ...extra });
      renderWithProviders(formRoutes(), { route: '/me/characters/new' });
      fireEvent.change(await screen.findByLabelText('In-game name'), { target: { value: 'sunofsinz' } });
      fireEvent.click(screen.getByRole('button', { name: 'Find' }));
      return fetchMock;
    }

    it('offers "Add it manually" for an empty lookup and reveals sorted fields with the IGN prefilled', async () => {
      await lookupEmpty();
      fireEvent.click(await screen.findByRole('button', { name: 'Add it manually' }));
      expect(screen.getByLabelText('World')).toBeInTheDocument();
      expect(screen.getByLabelText('Level')).toBeInTheDocument();
      expect(screen.getByLabelText('Character name')).toHaveValue('sunofsinz');
      const options = Array.from((screen.getByLabelText('Class') as HTMLSelectElement).options).map((o) => o.text);
      expect(options.slice(1)).toEqual(['Adele', 'bishop', 'Zero']);
    });

    it('saves a manual character via POST /api/characters/manual', async () => {
      const fetchMock = await lookupEmpty({ 'POST /api/characters/manual': manualChar });
      fireEvent.click(await screen.findByRole('button', { name: 'Add it manually' }));
      fireEvent.change(screen.getByLabelText('World'), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'Adele' } });
      fireEvent.change(screen.getByLabelText('Level'), { target: { value: '250' } });
      fireEvent.change(screen.getByLabelText('Combat power'), { target: { value: '1,000' } });
      fireEvent.change(screen.getByLabelText('Guild'), { target: { value: 'g1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('heading', { name: 'My list' })).toBeInTheDocument();
      const post = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/characters/manual')!;
      expect(bodyOf(post)).toEqual({
        ign: 'sunofsinz', worldId: 1, jobName: 'Adele', level: 250, combatPower: 1000, guildId: 'g1',
      });
    });

    it('rejects a level of 0 or empty without posting', async () => {
      const fetchMock = await lookupEmpty({ 'POST /api/characters/manual': manualChar });
      fireEvent.click(await screen.findByRole('button', { name: 'Add it manually' }));
      fireEvent.change(screen.getByLabelText('World'), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'Adele' } });
      fireEvent.change(screen.getByLabelText('Combat power'), { target: { value: '1000' } });
      fireEvent.change(screen.getByLabelText('Guild'), { target: { value: 'g1' } });
      for (const level of ['0', '']) {
        fireEvent.change(screen.getByLabelText('Level'), { target: { value: level } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a level from 1 to 300.');
      }
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/characters/manual')).toBe(false);
    });

    it('offers "Add it manually" after a lookup error', async () => {
      const fetchMock = mockApi({ ...manualShared });
      const base = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input, init) =>
        String(input) === '/api/characters/lookup'
          ? new Response(JSON.stringify({ error: { code: 'NEXON_UNAVAILABLE', message: 'x' } }), { status: 502 })
          : base(input, init),
      );
      renderWithProviders(formRoutes(), { route: '/me/characters/new' });
      fireEvent.change(await screen.findByLabelText('In-game name'), { target: { value: 'x' } });
      fireEvent.click(screen.getByRole('button', { name: 'Find' }));
      expect(await screen.findByRole('button', { name: 'Add it manually' })).toBeInTheDocument();
    });

    it('offers "Not your character? Add it manually" under previews', async () => {
      mockApi({ ...manualShared, 'POST /api/characters/lookup': [preview] });
      renderWithProviders(formRoutes(), { route: '/me/characters/new' });
      fireEvent.change(await screen.findByLabelText('In-game name'), { target: { value: 'Lily' } });
      fireEvent.click(screen.getByRole('button', { name: 'Find' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Not your character? Add it manually' }));
      expect(screen.getByLabelText('Class')).toBeInTheDocument();
    });

    it('edit of a manual character shows class and level and PATCHes them', async () => {
      const fetchMock = mockApi({
        ...manualShared,
        '/api/characters/m1': manualChar,
        'PATCH /api/characters/m1': manualChar,
      });
      renderWithProviders(formRoutes(), { route: '/me/characters/m1/edit' });
      expect(await screen.findByLabelText('Class')).toHaveValue('Retired Class');
      expect(screen.getByLabelText('Level')).toHaveValue('200');
      await screen.findByRole('option', { name: 'Adele' });
      fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'Adele' } });
      fireEvent.change(screen.getByLabelText('Level'), { target: { value: '210' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('heading', { name: 'My list' });
      const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PATCH')!;
      expect(bodyOf(patch)).toEqual({ combatPower: 1500000000, guildId: 'g1', jobName: 'Adele', level: 210 });
    });

    it('edit of a nexon character shows no class or level', async () => {
      mockApi({ ...manualShared, '/api/characters/c1': character });
      renderWithProviders(formRoutes(), { route: '/me/characters/c1/edit' });
      await screen.findByLabelText('Combat power');
      expect(screen.queryByLabelText('Class')).toBeNull();
      expect(screen.queryByLabelText('Level')).toBeNull();
    });
  });
});
