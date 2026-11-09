import { Link, useNavigate, useParams } from 'react-router-dom';
import { POST_TYPE_LABELS } from '@pf/shared';
import type { PostDetailDTO, RarityTierDTO, RequestDTO } from '@pf/shared';
import { useRarityTiers } from '../api/hooks';
import {
  useAcceptRequest,
  useCancelRequest,
  useClosePost,
  useDeclineRequest,
  useDeletePost,
  usePost,
  useRemoveMember,
  useRenewPost,
} from '../api/postHooks';
import { ApiError } from '../api/client';
import { friendlyError } from '../api/errors';
import { CharacterCard } from '../components/card/CharacterCard';
import { formatCp } from '../components/card/format';
import { LineupView } from '../components/post/LineupView';
import { bossLabel } from '../components/post/labels';
import { formatWhen } from '../components/post/time';
import '../components/post/post.css';

const STATUS_LABELS = { open: 'Open', full: 'Full', closed: 'Closed' } as const;

/** Task 12 fills this with the request / invite / leave actions for non-posters. */
function ViewerActions(_props: { post: PostDetailDTO }) {
  return null;
}

function RequestList({
  title,
  requests,
  post,
  tiers,
  actions,
}: {
  title: string;
  requests: RequestDTO[];
  post: PostDetailDTO;
  tiers: RarityTierDTO[];
  actions: (r: RequestDTO) => React.ReactNode;
}) {
  const bossContext = post.bosses.map((b) => ({ bossDifficultyId: b.bossDifficultyId, label: bossLabel(b) }));
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {requests.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul className="lineup" style={{ listStyle: 'none', padding: 0 }}>
          {requests.map((r) => (
            <li key={r.id} className="lineup__item">
              <CharacterCard character={r.character} tiers={tiers} bossContext={bossContext} />
              {post.minCp !== null && r.character.combatPower < post.minCp && <span className="post-warn">Below min CP</span>}
              <div className="post-actions">{actions(r)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PostDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const post = usePost(id);
  const tiers = useRarityTiers();
  const close = useClosePost(id ?? '');
  const del = useDeletePost(id ?? '');
  const renew = useRenewPost(id ?? '');
  const accept = useAcceptRequest();
  const decline = useDeclineRequest();
  const cancel = useCancelRequest();
  const remove = useRemoveMember(id ?? '');

  if (post.isLoading) return <p>Loading…</p>;
  if (post.error) {
    const notFound = post.error instanceof ApiError && post.error.status === 404;
    return <p role="alert">{notFound ? "This post isn't available." : friendlyError(post.error)}</p>;
  }
  const p = post.data;
  if (!p) return null;
  const tierList = tiers.data ?? [];

  const closed = p.status === 'closed';
  const statusText = p.deleted ? 'Deleted' : STATUS_LABELS[p.status];
  const posterCanManage = p.isPoster && !p.deleted;
  const posterActive = posterCanManage && !closed;
  const mutationError = [close, del, renew, accept, decline, cancel, remove].find((m) => m.error)?.error;

  const onDelete = () => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    del.mutate(undefined, { onSuccess: () => navigate('/') });
  };

  return (
    <article>
      <header className="post-detail__head">
        <span className={`post-badge post-badge--${p.type}`}>{POST_TYPE_LABELS[p.type]}</span>
        <span className={`post-pill post-pill--${p.deleted ? 'deleted' : p.status}`}>{statusText}</span>
        <span>{formatWhen(p.scheduledAt)}</span>
      </header>
      <ul className="post-card__bosses">
        {p.bosses.map((b) => (
          <li key={b.bossDifficultyId}>{bossLabel(b)}</li>
        ))}
      </ul>
      <div className="post-card__meta">
        {p.world.name} · {p.guild.name}
      </div>
      {p.type === 'recruiting' && (
        <div className="post-card__slots">
          <span>{`${p.memberCount}/${p.partySize}`}</span>
          {p.minCp !== null && <span>{` · Min CP ${formatCp(p.minCp)}`}</span>}
        </div>
      )}
      {p.note && <p>{p.note}</p>}
      {closed && <div className="post-banner">This party has ended</div>}

      {mutationError && <p role="alert">{friendlyError(mutationError)}</p>}

      {posterCanManage && (
        <div className="post-actions">
          {posterActive && <Link to={`/posts/${p.id}/edit`}>Edit</Link>}
          {posterActive && (
            <button type="button" onClick={() => close.mutate()}>
              Close
            </button>
          )}
          {posterActive && p.scheduledAt === null && (
            <button type="button" onClick={() => renew.mutate()}>
              Renew
            </button>
          )}
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}

      <h2>Lineup</h2>
      <LineupView post={p} tiers={tierList} onRemove={posterActive ? (memberId) => remove.mutate(memberId) : undefined} />

      {posterActive && (
        <RequestList
          title="Applicants"
          requests={p.incomingRequests}
          post={p}
          tiers={tierList}
          actions={(r) => (
            <>
              <button type="button" onClick={() => accept.mutate(r.id)}>
                Accept
              </button>
              <button type="button" onClick={() => decline.mutate(r.id)}>
                Decline
              </button>
            </>
          )}
        />
      )}
      {posterActive && (
        <RequestList
          title="Invites sent"
          requests={p.sentInvites}
          post={p}
          tiers={tierList}
          actions={(r) => (
            <button type="button" onClick={() => cancel.mutate(r.id)}>
              Cancel
            </button>
          )}
        />
      )}

      {!p.isPoster && !p.deleted && <ViewerActions post={p} />}
    </article>
  );
}
