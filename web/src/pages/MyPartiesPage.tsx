import { LoginButton } from '../components/LoginDialog';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { PostDetailDTO, PostSummaryDTO, RarityTierDTO, RequestWithPostDTO } from '@pf/shared';
import { useMe, useRarityTiers } from '../api/hooks';
import {
  useAcceptRequest,
  useCancelRequest,
  useDeclineRequest,
  useMyParties,
  useMyPosts,
  useMyRequests,
} from '../api/postHooks';
import { friendlyError } from '../api/errors';
import { LineupView } from '../components/post/LineupView';
import { PostCard } from '../components/post/PostCard';
import { StatusPill } from '../components/post/StatusPill';
import { bossLabel } from '../components/post/labels';
import { whenLabel } from '../components/post/time';
import { useLastActionError } from '../components/post/useLastActionError';
import '../components/post/post.css';

const TABS = [
  { key: 'parties', label: 'Parties' },
  { key: 'posts', label: 'My posts' },
  { key: 'requests', label: 'Requests & invites' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function PartyItem({ party, tiers }: { party: PostDetailDTO; tiers: RarityTierDTO[] }) {
  return (
    <li className="post-card">
      <div className="post-card__head">
        <StatusPill status={party.status} deleted={party.deleted} recruitmentClosed={party.recruitmentClosed} />
        <span className="post-card__when">{whenLabel(party)}</span>
      </div>
      <ul className="post-card__bosses">
        {party.bosses.map((b) => (
          <li key={b.bossDifficultyId}>{bossLabel(b)}</li>
        ))}
      </ul>
      <LineupView post={party} tiers={tiers} />
      <Link className="btn btn--secondary post-card__link" to={`/posts/${party.id}`}>
        View post
      </Link>
    </li>
  );
}

function PartiesTab({ tiers }: { tiers: RarityTierDTO[] }) {
  const parties = useMyParties();
  if (parties.isLoading) return <p>Loading…</p>;
  if (parties.error) return <p role="alert">{friendlyError(parties.error)}</p>;
  const all = parties.data ?? [];
  const isUpcoming = (p: PostDetailDTO) => !p.deleted && (p.status === 'open' || p.status === 'full' || !!p.recruitmentClosed);
  const upcoming = all.filter(isUpcoming);
  const past = all.filter((p) => !isUpcoming(p));
  return (
    <>
      <section aria-label="Upcoming">
        <h2>Upcoming</h2>
        {upcoming.length === 0 ? (
          <p>No upcoming parties.</p>
        ) : (
          <ul className="post-list-plain my-parties__list my-parties__list--parties">
            {upcoming.map((p) => (
              <PartyItem key={p.id} party={p} tiers={tiers} />
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 && (
        <section aria-label="Past">
          <h2>Past</h2>
          <ul className="post-list-plain my-parties__list my-parties__list--parties">
            {past.map((p) => (
              <PartyItem key={p.id} party={p} tiers={tiers} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PostsTab({ tiers }: { tiers: RarityTierDTO[] }) {
  const posts = useMyPosts();
  if (posts.isLoading) return <p>Loading…</p>;
  if (posts.error) return <p role="alert">{friendlyError(posts.error)}</p>;
  const list: PostSummaryDTO[] = posts.data ?? [];
  if (list.length === 0) return <p>You haven&apos;t posted anything.</p>;
  return (
    <ul className="post-list-plain my-parties__list">
      {list.map((p) => (
        <li key={p.id}>
          <StatusPill status={p.status} deleted={p.deleted} recruitmentClosed={p.recruitmentClosed} />
          <PostCard post={p} tiers={tiers} />
        </li>
      ))}
    </ul>
  );
}

function RequestsTab({ tiers }: { tiers: RarityTierDTO[] }) {
  const requests = useMyRequests();
  const accept = useAcceptRequest();
  const decline = useDeclineRequest();
  const cancel = useCancelRequest();
  const navigate = useNavigate();
  const { error, run } = useLastActionError({ accept, decline, cancel });
  if (requests.isLoading) return <p>Loading…</p>;
  if (requests.error) return <p role="alert">{friendlyError(requests.error)}</p>;
  const { incomingInvites = [], outgoingRequests = [] } = requests.data ?? {};
  const busy = accept.isPending || decline.isPending || cancel.isPending;

  const item = (r: RequestWithPostDTO, label: string, actions: React.ReactNode) => (
    <li key={r.id}>
      <p>{label}</p>
      <PostCard post={r.post} tiers={tiers} />
      <div className="actions">{actions}</div>
    </li>
  );

  return (
    <>
      {error && <p role="alert">{friendlyError(error)}</p>}
      <section aria-label="Invites">
        <h2>Invites</h2>
        {incomingInvites.length === 0 ? (
          <p>No invites.</p>
        ) : (
          <ul className="post-list-plain my-parties__list">
            {incomingInvites.map((r) =>
              item(
                r,
                `Invite for ${r.character.ign}`,
                <>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() =>
                      run('accept', () => accept.mutate(r.id, { onSuccess: () => navigate(`/posts/${r.postId}`) }))
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy}
                    onClick={() => run('decline', () => decline.mutate(r.id))}
                  >
                    Decline
                  </button>
                </>,
              ),
            )}
          </ul>
        )}
      </section>
      <section aria-label="Your requests">
        <h2>Your requests</h2>
        {outgoingRequests.length === 0 ? (
          <p>No outgoing requests.</p>
        ) : (
          <ul className="post-list-plain my-parties__list">
            {outgoingRequests.map((r) =>
              item(
                r,
                `Request with ${r.character.ign}`,
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => run('cancel', () => cancel.mutate(r.id))}
                >
                  Cancel
                </button>,
              ),
            )}
          </ul>
        )}
      </section>
    </>
  );
}

export function MyPartiesPage() {
  const me = useMe();
  const tiers = useRarityTiers();
  const [params, setParams] = useSearchParams();

  if (me.isPending) return <p>Loading…</p>;
  if (!me.data) {
    return (
      <section>
        <h1>My parties</h1>
        <p>Log in to see your parties.</p>
        <LoginButton />
      </section>
    );
  }

  const raw = params.get('tab');
  const tab: TabKey = TABS.find((t) => t.key === raw)?.key ?? 'parties';
  const tierList = tiers.data ?? [];

  return (
    <section className="my-parties">
      <h1>My parties</h1>
      <div role="group" aria-label="Sections" className="actions my-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="chip"
            aria-pressed={tab === t.key}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'parties' && <PartiesTab tiers={tierList} />}
      {tab === 'posts' && <PostsTab tiers={tierList} />}
      {tab === 'requests' && <RequestsTab tiers={tierList} />}
    </section>
  );
}
