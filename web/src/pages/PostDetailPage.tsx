import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { POST_TYPE_LABELS } from '@pf/shared';
import { useRarityTiers } from '../api/hooks';
import {
  useAcceptRequest,
  useAnnouncePost,
  useCancelRequest,
  useClosePost,
  useDeclineRequest,
  useDeletePost,
  usePost,
  useRemoveMember,
  useReopenPost,
  useRenewPost,
} from '../api/postHooks';
import { ApiError } from '../api/client';
import { friendlyError } from '../api/errors';
import { formatCp } from '../components/card/format';
import { LineupView } from '../components/post/LineupView';
import { bossLabel, postLabel } from '../components/post/labels';
import { RequestList, ViewerActions } from '../components/post/ViewerActions';
import { StatusPill } from '../components/post/StatusPill';
import { WhenSection } from '../components/post/WhenSection';
import { FinalizeTimeDialog } from '../components/post/FinalizeTimeDialog';
import { formatWhen } from '../components/post/time';
import { useLastActionError } from '../components/post/useLastActionError';
import '../components/post/post.css';

function DiscordAnnouncementButton({ availableAt, pending, onClick }: { availableAt: string; pending: boolean; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const availableTime = new Date(availableAt).getTime();
  useEffect(() => {
    setNow(Date.now());
    const delay = availableTime - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [availableTime]);
  const coolingDown = !Number.isFinite(availableTime) || now < availableTime;
  return (
    <div className="discord-announcement">
      <button type="button" className="btn btn--secondary" disabled={coolingDown || pending} onClick={onClick}>
        {pending ? 'Sending…' : 'Notify Discord'}
      </button>
      {coolingDown && Number.isFinite(availableTime) && <small>{`Available ${new Date(availableTime).toLocaleString()}`}</small>}
    </div>
  );
}

export function PostDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const post = usePost(id, { live: true });
  const tiers = useRarityTiers();
  const close = useClosePost(id ?? '');
  const del = useDeletePost(id ?? '');
  const renew = useRenewPost(id ?? '');
  const reopen = useReopenPost(id ?? '');
  const announce = useAnnouncePost(id ?? '');
  const accept = useAcceptRequest();
  const decline = useDeclineRequest();
  const cancel = useCancelRequest();
  const remove = useRemoveMember(id ?? '');
  const finalizeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [finalizing, setFinalizing] = useState(false);
  const { error: mutationError, run } = useLastActionError({
    close,
    del,
    renew,
    reopen,
    announce,
    accept,
    decline,
    cancel,
    remove,
  });

  // Focus the trigger only after the modal has unmounted; while it is open the page behind it is inert.
  useEffect(() => {
    if (!finalizing && returnFocus.current) {
      returnFocus.current = false;
      finalizeRef.current?.focus();
    }
  }, [finalizing]);
  const closeFinalize = () => {
    returnFocus.current = true;
    setFinalizing(false);
  };

  if (post.isLoading) return <p>Loading…</p>;
  const unavailable = post.error instanceof ApiError && (post.error.status === 403 || post.error.status === 404);
  if (post.error && (!post.data || unavailable)) {
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
  const finalized = !!p.recruitmentClosed && !p.deleted;
  const posterActive = posterCanManage && (!closed || finalized);
  const posterRecruiting = posterActive && !finalized;

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
      {post.error && <p role="status">Couldn't refresh this post. Your changes are still here; we'll try again.</p>}
      <header className="post-detail__head">
        <span className={`post-badge post-badge--${p.type}`}>
          {POST_TYPE_LABELS[p.type]}
        </span>
        <StatusPill status={p.status} deleted={p.deleted} recruitmentClosed={finalized} />
        {/* The When section below carries the time; the header stays compact. */}
        <span>
          {p.world.name} · {p.guild.name}
        </span>
      </header>
      <ul className="post-card__bosses">
        {p.bosses.map((b) => (
          <li key={b.bossDifficultyId}>{bossLabel(b)}</li>
        ))}
      </ul>
      <WhenSection post={p} members={p.members} allowAvailabilityEdit />
      {p.type === 'recruiting' && (
        <div className="post-card__slots">
          <span>{`${p.memberCount}/${p.partySize}`}</span>
          {p.minCp !== null && <span>{` · Min CP ${formatCp(p.minCp)}`}</span>}
        </div>
      )}
      {p.note && <p>{p.note}</p>}
      {closed && <div className="post-banner">{finalized ? 'Recruitment is closed. Your party is scheduled.' : 'This party has ended'}</div>}

      {mutationError && <p role="alert">{friendlyError(mutationError)}</p>}

      {posterCanManage && (
        <div className="actions post-detail__actions">
          {posterRecruiting && (
            <Link className="btn btn--secondary" to={`/posts/${p.id}/edit`}>
              Edit
            </Link>
          )}
          {posterActive && p.type === 'recruiting' && (
            <button
              ref={finalizeRef}
              type="button"
              className="btn btn--secondary"
              onClick={() => setFinalizing(true)}
            >
              {p.scheduledAt ? 'Change time' : 'Finalize time'}
            </button>
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
          {posterRecruiting && p.status === 'open' && <DiscordAnnouncementButton
            availableAt={p.discordAnnouncementAvailableAt ?? new Date(new Date(p.createdAt).getTime() + 86_400_000).toISOString()}
            pending={announce.isPending}
            onClick={() => run('announce', () => announce.mutate())}
          />}
          {closed && (
            <button type="button" className="btn btn--secondary" disabled={reopen.isPending} onClick={() => run('reopen', () => reopen.mutate())}>
              {reopen.isPending ? 'Reopening…' : 'Reopen'}
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
      {announce.isSuccess && <p role="status" className="when-section__caption">Discord notification queued.</p>}
      {posterCanManage && closed && <p className="when-section__caption">Reopening keeps the lineup, clears the final time and weekly reminders, and opens recruitment for seven days.{p.type === 'recruiting' && p.partySize !== null && p.memberCount >= p.partySize ? ' The party is full; remove a member to show it on the board.' : ''}</p>}

      {!closed && !p.deleted && (
        <section className="post-expiry" aria-labelledby="post-expiry-title">
          <div>
            <h2 id="post-expiry-title">Post expiry</h2>
            <p>Automatically closes <time dateTime={p.expiresAt}>{formatWhen(p.expiresAt)}</time></p>
          </div>
          {p.canRenew && (
            <button type="button" className="btn btn--secondary" disabled={renew.isPending} onClick={() => run('renew', () => renew.mutate())}>
              Renew for 7 days
            </button>
          )}
        </section>
      )}

      {finalizing && <FinalizeTimeDialog post={p} onClose={closeFinalize} />}

      <h2>Lineup</h2>
      <LineupView
        post={p}
        tiers={tierList}
        onRemove={
          posterActive
            ? (memberId) => run('remove', () => remove.mutate(memberId))
            : undefined
        }
        onLeave={!p.isPoster && !p.deleted && (!closed || finalized) ? onLeave : undefined}
        busy={remove.isPending}
      />

      {posterRecruiting && (
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
      {posterRecruiting && (
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
