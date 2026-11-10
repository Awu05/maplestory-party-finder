import { Link, useNavigate, useParams } from 'react-router-dom';
import { POST_TYPE_LABELS } from '@pf/shared';
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
import { formatCp } from '../components/card/format';
import { LineupView } from '../components/post/LineupView';
import { bossLabel, postLabel } from '../components/post/labels';
import { RequestList, ViewerActions } from '../components/post/ViewerActions';
import { StatusPill } from '../components/post/StatusPill';
import { formatWhen } from '../components/post/time';
import { useLastActionError } from '../components/post/useLastActionError';
import '../components/post/post.css';

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
  const { error: mutationError, run } = useLastActionError({
    close,
    del,
    renew,
    accept,
    decline,
    cancel,
    remove,
  });

  if (post.isLoading) return <p>Loading…</p>;
  if (post.error) {
    const notFound =
      post.error instanceof ApiError && post.error.status === 404;
    return (
      <p role="alert">
        {notFound ? "This post isn't available." : friendlyError(post.error)}
      </p>
    );
  }
  const p = post.data;
  if (!p) return null;
  const tierList = tiers.data ?? [];

  const closed = p.status === 'closed';
  const posterCanManage = p.isPoster && !p.deleted;
  const posterActive = posterCanManage && !closed;

  const onDelete = () => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    run('del', () => del.mutate(undefined, { onSuccess: () => navigate('/') }));
  };
  const onLeave = (memberId: string) => {
    if (!window.confirm('Leave this party?')) return;
    run('remove', () => remove.mutate(memberId));
  };

  return (
    <article className="post-detail">
      <header className="post-detail__head">
        <span className={`post-badge post-badge--${p.type}`}>
          {POST_TYPE_LABELS[p.type]}
        </span>
        <StatusPill status={p.status} deleted={p.deleted} />
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
        <div className="actions post-detail__actions">
          {posterActive && (
            <Link className="btn btn--secondary" to={`/posts/${p.id}/edit`}>
              Edit
            </Link>
          )}
          {posterActive && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={close.isPending}
              onClick={() => run('close', () => close.mutate())}
            >
              Close
            </button>
          )}
          {p.canRenew && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={renew.isPending}
              onClick={() => run('renew', () => renew.mutate())}
            >
              Renew
            </button>
          )}
          <button
            type="button"
            className="btn btn--danger"
            disabled={del.isPending}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>
      )}

      <h2>Lineup</h2>
      <LineupView
        post={p}
        tiers={tierList}
        onRemove={
          posterActive
            ? (memberId) => run('remove', () => remove.mutate(memberId))
            : undefined
        }
        onLeave={!p.isPoster && !p.deleted && !closed ? onLeave : undefined}
        busy={remove.isPending}
      />

      {posterActive && (
        <RequestList
          title="Applicants"
          requests={p.incomingRequests}
          post={p}
          tiers={tierList}
          actions={(r) => (
            <>
              <button
                type="button"
                className="btn btn--primary"
                disabled={accept.isPending || decline.isPending}
                onClick={() => run('accept', () => accept.mutate(r.id))}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={accept.isPending || decline.isPending}
                onClick={() => run('decline', () => decline.mutate(r.id))}
              >
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
            <button
              type="button"
              className="btn btn--secondary"
              disabled={cancel.isPending}
              onClick={() => run('cancel', () => cancel.mutate(r.id))}
            >
              Cancel
            </button>
          )}
        />
      )}

      {p.receivedInvites.length > 0 && (
        <section aria-label="Invites received">
          <h2>Invites received</h2>
          <ul className="post-requests">
            {p.receivedInvites.map((r) => (
              <li key={r.id}>
                <Link to={`/posts/${r.postId}`}>{postLabel(r.post)}</Link>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={accept.isPending || decline.isPending}
                    onClick={() =>
                      run('accept', () =>
                        accept.mutate(r.id, {
                          onSuccess: () => navigate(`/posts/${r.postId}`),
                        }),
                      )
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={accept.isPending || decline.isPending}
                    onClick={() => run('decline', () => decline.mutate(r.id))}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!p.isPoster && !p.deleted && <ViewerActions post={p} />}
    </article>
  );
}
