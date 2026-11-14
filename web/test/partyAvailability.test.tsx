import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PartyMemberDTO, PostSummaryDTO } from '@pf/shared';
import { PartyAvailability } from '../src/components/post/PartyAvailability';
import { mockApi, renderWithProviders } from './setup';

vi.mock('../src/lib/timeZone', () => ({ browserTimeZone: () => 'America/New_York' }));

const member = (id: string, role: PartyMemberDTO['role'], isMine = false): PartyMemberDTO => ({
  id, role, isMine, characterId: `c-${id}`, character: null, cpAtJoin: 1,
  joinedAt: '2026-11-10T00:00:00Z', freeTimes: [126, 128], freeTimesZone: 'America/New_York',
  snapshot: { ign: id, jobName: 'Bishop', level: 280, imageUrl: '', worldName: 'Kronos', guildName: 'G' },
});
const members = [member('Lily', 'poster'), member('Bob', 'member', true)];
const post: PostSummaryDTO = {
  id: 'p1', type: 'recruiting', world: { id: 1, name: 'Kronos' }, guild: { id: 'g1', name: 'G' },
  poster: members[0], bosses: [], scheduledAt: null, weeklyTimeZone: null,
  freeTimes: [136], freeTimesZone: 'UTC', expiresAt: '2026-12-01T00:00:00Z', createdAt: '2026-11-10T00:00:00Z',
  partySize: 4, memberCount: 2, minCp: null, title: '', note: '', status: 'open', deleted: false, isPoster: false,
};

it('shows a named color legend, zoned overlaps and an everyone-free indicator', () => {
  renderWithProviders(<PartyAvailability post={post} members={members} />);
  const legend = screen.getByRole('list', { name: 'Availability legend' });
  expect(within(legend).getByText('Lily')).toBeVisible();
  expect(within(legend).getByText('Bob')).toBeVisible();
  const overlap = screen.getByRole('gridcell', { name: /Tue 3p/ });
  expect(overlap).toHaveAccessibleName(/Lily.*Bob.*Everyone available/);
  expect(overlap).toHaveClass('ftg__cell--all');
  expect(overlap.getAttribute('style')).toContain('linear-gradient');
  expect(screen.getByRole('gridcell', { name: /Tue 4p/ })).not.toHaveClass('ftg__cell--all');
});

it('shows a partial overlap rather than a full half-hour across quarter-hour time zones', () => {
  const quarterZoneMember = { ...members[1], freeTimes: [147], freeTimesZone: 'Asia/Kathmandu' };
  renderWithProviders(<PartyAvailability post={post} members={[members[0], quarterZoneMember]} />);
  const overlap = screen.getByRole('gridcell', { name: /Tue 3p/ });
  expect(overlap).toHaveAccessibleName(/Lily.*Bob \(first 15 minutes\).*2 overlap/);
  expect(overlap).not.toHaveClass('ftg__cell--all');
  expect(overlap.getAttribute('style')).toContain('50%');
});

it('lets keyboard users inspect who is free in a read-only grid', () => {
  renderWithProviders(<PartyAvailability post={post} members={members} />);
  const cell = screen.getByRole('gridcell', { name: /Tue 3p/ });
  act(() => cell.focus());
  expect(screen.getByRole('status')).toHaveTextContent(/Lily.*Bob.*Everyone available/);
  fireEvent.keyDown(cell, { key: 'ArrowDown' });
  expect(screen.getByRole('gridcell', { name: /Tue 3:30p/ })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Tue 3:30p');
});

it('allows accepted members to edit and save their own availability in their time zone', async () => {
  const save = vi.fn((_init?: RequestInit) => post);
  mockApi({ 'PUT /api/posts/p1/members/Bob/free-times': save });
  renderWithProviders(<PartyAvailability post={post} members={members} allowEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit availability for Bob' }));
  expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'false');
  fireEvent.click(screen.getByRole('button', { name: /Tue 5p/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save availability' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(save.mock.calls[0]?.[0]?.body))).toEqual({ freeTimes: [126, 128, 130], freeTimesZone: 'America/New_York' });
});

it('never offers editing for outsiders or ended parties, and missing selections prevent an everyone-free result', () => {
  renderWithProviders(<PartyAvailability post={{ ...post, status: 'closed' }} members={[...members, { ...member('Sue', 'member'), freeTimes: [], freeTimesZone: null }]} allowEdit />);
  expect(screen.queryByRole('button', { name: /Edit availability/ })).toBeNull();
  expect(screen.getByRole('gridcell', { name: /Tue 3p/ })).not.toHaveClass('ftg__cell--all');
  expect(screen.getByText(/No times selected/)).toBeVisible();
});
