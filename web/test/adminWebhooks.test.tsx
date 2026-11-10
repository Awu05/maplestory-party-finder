import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { GuildsAdmin } from '../src/pages/admin/GuildsAdmin';
import { WebhooksAdmin } from '../src/pages/admin/WebhooksAdmin';
import { mockApi, renderWithProviders } from './setup';

const guild = (id: string, name: string, webhookUrl: string | null) => ({
  id, name, iconUrl: null, worldIds: [1], active: true, webhookUrl,
});

const health = [
  {
    guildId: 'g1', guildName: 'Alpha', hasWebhook: true, active: true,
    lastSentAt: new Date(Date.now() - 5 * 60_000).toISOString(), pending: 2, failedLast24h: 1,
    recentFailures: [
      { id: 'f1', eventType: 'post.created', attempts: 3, lastError: 'HTTP 500', createdAt: new Date(Date.now() - 3600_000).toISOString() },
    ],
  },
  { guildId: 'g2', guildName: 'Beta', hasWebhook: true, active: true, lastSentAt: null, pending: 0, failedLast24h: 0, recentFailures: [] },
  { guildId: 'g3', guildName: 'Gamma', hasWebhook: false, active: true, lastSentAt: null, pending: 0, failedLast24h: 0, recentFailures: [] },
];

describe('admin webhooks', () => {
  it('test button posts /api/admin/guilds/g1/test-webhook and shows Sent ✓; error shows Failed: HTTP 404', async () => {
    let result: unknown = { ok: true };
    const post = vi.fn(() => result);
    mockApi({
      '/api/admin/guilds': [guild('g1', 'Alpha', 'https://discord.com/api/webhooks/1/x'), guild('g2', 'Beta', null)],
      '/api/worlds?all=1': [],
      '/api/admin/webhooks/health': [],
      'POST /api/admin/guilds/g1/test-webhook': post,
    });
    renderWithProviders(<GuildsAdmin />);
    expect(screen.queryByRole('button', { name: 'Send test message Beta' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Send test message Alpha' }));
    expect(await screen.findByText('Sent ✓')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);

    result = { ok: false, error: 'HTTP 404' };
    fireEvent.click(screen.getByRole('button', { name: 'Send test message Alpha' }));
    expect(await screen.findByText('Failed: HTTP 404')).toBeInTheDocument();
    expect(screen.queryByText('Sent ✓')).not.toBeInTheDocument();
  });

  it('health table rows and failure expansion', async () => {
    mockApi({ '/api/admin/webhooks/health': health });
    renderWithProviders(<WebhooksAdmin />);
    const row = (await screen.findByText('Alpha')).closest('tr')!;
    expect(within(row).getByText('✓')).toBeInTheDocument();
    expect(within(row).getByText('5m ago')).toBeInTheDocument();
    expect(within(row).getByLabelText('Pending').textContent).toBe('2');
    expect(within(row).getByLabelText('Failed 24h').textContent).toBe('1');
    expect(screen.queryByText('HTTP 500')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Show failures Alpha' }));
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('post.created')).toBeInTheDocument();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
  });

  it('red pill when failedLast24h>0, gray when no webhook', async () => {
    mockApi({ '/api/admin/webhooks/health': health });
    renderWithProviders(<WebhooksAdmin />);
    await screen.findByText('Alpha');
    expect(screen.getByTestId('pill-g1')).toHaveClass('pill--red');
    expect(screen.getByTestId('pill-g2')).not.toHaveClass('pill--red');
    expect(screen.getByTestId('pill-g3')).toHaveClass('pill--gray');
  });

  it('Refresh refetches health', async () => {
    const get = vi.fn(() => health);
    mockApi({ '/api/admin/webhooks/health': get });
    renderWithProviders(<WebhooksAdmin />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
