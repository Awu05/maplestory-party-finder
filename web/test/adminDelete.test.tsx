import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { GuildsAdmin } from '../src/pages/admin/GuildsAdmin';
import { mockApi, renderWithProviders } from './setup';

/** Makes requests matching `when` fail with an API error body; everything else goes to the existing mock. */
function failWhen(fetchMock: ReturnType<typeof mockApi>, when: (method: string, url: string) => boolean, status: number, error: Record<string, unknown>) {
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input, init) => {
    if (when((init?.method ?? 'GET').toUpperCase(), String(input))) return new Response(JSON.stringify({ error }), { status });
    return base(input, init);
  });
}

const guild = (id: string, name: string) => ({ id, name, iconUrl: null, worldIds: [1], active: true, webhookUrl: null });

describe('guild delete', () => {
  it('opens a confirm with usage counts, deletes, refreshes, and focus returns to the opener', async () => {
    let guilds = [guild('g1', 'Alpha'), guild('g2', 'Beta')];
    const del = vi.fn(() => { guilds = guilds.filter((g) => g.id !== 'g1'); return undefined; });
    mockApi({
      '/api/admin/guilds': () => guilds,
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 3, posts: 1 },
      'DELETE /api/admin/guilds/g1': del,
    });
    renderWithProviders(<GuildsAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete Alpha' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Delete Alpha?' });
    expect(await within(dialog).findByText('3 characters will have no guild and 1 post will lose it as its Discord destination.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('Delete guild'));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Alpha' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Delete Beta' })).toBeInTheDocument();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('pluralizes counts and disables Delete guild while counts load', async () => {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((r) => { release = r; });
    const fetchMock = mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha')],
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 1, posts: 2 },
    });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (i, init) => { if (String(i).endsWith('/usage')) await gate; return base(i, init); });
    renderWithProviders(<GuildsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    const confirmBtn = await screen.findByText('Delete guild');
    expect(confirmBtn).toBeDisabled();
    release(undefined);
    expect(await screen.findByText('1 character will have no guild and 2 posts will lose it as their Discord destination.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Delete guild')).toBeEnabled());
  });

  it('shows a delete error inside the dialog', async () => {
    const fetchMock = mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha')],
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 0, posts: 0 },
    });
    failWhen(fetchMock, (m) => m === 'DELETE', 500, { code: 'BOOM', message: 'Server exploded' });
    renderWithProviders(<GuildsAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Alpha' }));
    await waitFor(() => expect(screen.getByText('Delete guild')).toBeEnabled());
    fireEvent.click(screen.getByText('Delete guild'));
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('Cancel closes the dialog and returns focus to the Delete button', async () => {
    mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha')],
      '/api/worlds?all=1': [],
      '/api/bosses': [],
      '/api/admin/guilds/g1/usage': { characters: 0, posts: 0 },
    });
    renderWithProviders(<GuildsAdmin />);
    const opener = await screen.findByRole('button', { name: 'Delete Alpha' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(document.querySelector('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });
});
