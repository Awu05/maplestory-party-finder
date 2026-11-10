import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO } from '@pf/shared';
import { ViewerActions } from '../src/components/post/ViewerActions';
import { mockApi, renderWithProviders } from './setup';

const character = (id: string, ign: string): CharacterDTO => ({
  id,
  ign,
  world: { id: 5, name: 'Kronos' },
  jobName: 'Bishop', archetype: 'magician',
  level: 280,
  imageUrl: `http://img/${ign}.png`,
  combatPower: 1_500_000_000,
  cpUpdatedAt: '2026-11-01T00:00:00Z',
  guild: { id: 'g1', name: 'Maple Guild', iconUrl: null }, manual: false,
  screenshotUrl: null,
  owner: { discordUsername: `${ign}#1` },
  isOwner: false,
  syncStatus: 'ok',
  lastSyncedAt: '2026-11-01T00:00:00Z',
});

const poster: PartyMemberDTO = {
  id: 'm1',
  role: 'poster',
  characterId: 'c-m1',
  cpAtJoin: 1_500_000_000,
  joinedAt: '2026-11-09T00:00:00Z',
  character: character('c-m1', 'Lily'),
  snapshot: {
    ign: 'Lily',
    jobName: 'Bishop',
    level: 280,
    imageUrl: 'http://img/Lily.png',
    worldName: 'Kronos',
    guildName: 'Maple Guild',
  },
  isMine: false,
};

const recruitingPost: PostDetailDTO = {
  id: 'p1',
  type: 'recruiting',
  world: { id: 5, name: 'Kronos' },
  guild: { id: 'g1', name: 'Maple Guild' },
  poster,
  bosses: [{ bossDifficultyId: 7, bossName: 'Lucid', difficulty: 'Hard' }],
  scheduledAt: '2026-12-01T20:00:00Z',
  expiresAt: '2026-12-02T00:00:00Z',
  createdAt: '2026-11-09T00:00:00Z',
  partySize: 4,
  memberCount: 1,
  minCp: null,
  note: '',
  status: 'open',
  deleted: false,
  isPoster: false,
  members: [poster],
  isMember: false,
  incomingRequests: [],
  sentInvites: [],
  myPending: [],
  receivedInvites: [],
  sentInvitesToThis: [],
  canRenew: false,
};

afterEach(() => vi.restoreAllMocks());

describe('ViewerActions', () => {
  it('Request to join then picking a character posts {characterId}', async () => {
    const fetchMock = mockApi({
      '/api/auth/me': {
        id: 'u1',
        discordUsername: 'me#1',
        avatarUrl: null,
        isAdmin: false,
      },
      '/api/me/parties': [],
      '/api/me/posts': [],
      '/api/characters?mine=1': [character('k1', 'KronosMain')],
      'POST /api/posts/p1/requests': {},
    });
    renderWithProviders(<ViewerActions post={recruitingPost} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Request to join' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /KronosMain/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            String(u) === '/api/posts/p1/requests' && i?.method === 'POST',
        ),
      ).toBe(true),
    );
    const call = fetchMock.mock.calls.find(
      ([u, i]) =>
        String(u) === '/api/posts/p1/requests' && i?.method === 'POST',
    )!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ characterId: 'k1' });
  });
});
