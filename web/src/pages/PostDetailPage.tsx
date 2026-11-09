import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { POST_TYPE_LABELS } from '@pf/shared';
import type { PostDetailDTO, PostSummaryDTO, RarityTierDTO, RequestDTO } from '@pf/shared';
import { useCharacters, useMe, useRarityTiers } from '../api/hooks';
import {
  useAcceptRequest,
  useCancelRequest,
  useClosePost,
  useDeclineRequest,
  useDeletePost,
  useInvite,
  useMyParties,
  useMyPosts,
  usePost,
  useRequestJoin,
  useRemoveMember,
  useRenewPost,
} from '../api/postHooks';
import { ApiError } from '../api/client';
import { friendlyError } from '../api/errors';
import { CharacterCard } from '../components/card/CharacterCard';
import { formatCp } from '../components/card/format';
import { CharacterPicker } from '../components/post/CharacterPicker';
import { LineupView } from '../components/post/LineupView';
import { bossLabel } from '../components/post/labels';
import { StatusPill } from '../components/post/StatusPill';
import { formatWhen } from '../components/post/time';
import { useLastActionError } from '../components/post/useLastActionError';
import '../components/post/post.css';

/** "Hard Lucid, Normal Will · Dec 1, 8:00 PM · 2/4" */
const postLabel = (p: PostSummaryDTO) =>
  `${p.bosses.map(bossLabel).join(', ')} · ${formatWhen(p.scheduledAt)} · ${p.memberCount}/${p.partySize}`;

function ViewerActions({ post }: { post: PostDetailDTO }) {
  const { data: me, isLoading } = useMe();
  const loggedIn = !!me;
  const [panel, setPanel] = useState<'request' | 'invite' | null>(null);
  const requestJoin = useRequestJoin(post.id);
  const invite = useInvite(post.id);
  const cancel = useCancelRequest();
  const accept = useAcceptRequest();
  const decline = useDeclineRequest();
  const open = post.status === 'open' && !post.deleted;
  const canRequest = loggedIn && open && post.type === 'recruiting';
  const canInvite = loggedIn && open && post.type === 'lfp';
  const characters = useCharacters({ mine: true }, { enabled: canRequest && panel === 'request' });
  const myParties = useMyParties();
  const myPosts = useMyPosts();
  const { error, run } = useLastActionError({ requestJoin, invite, cancel, accept, decline });

  if (isLoading) return null;
  if (!loggedIn) return <p>Log in with Discord to join.</p>;

  // A recruiting post that already has a pending invite to this LFP post is not offered again.
  const alreadyInvited = new Set(post.sentInvitesToThis.map((r) => r.postId));
  const inviteTargets = (myPosts.data ?? []).filter(
    (mp) =>
      mp.type === 'recruiting' && mp.status === 'open' && !mp.deleted && mp.world.id === post.world.id && !alreadyInvited.has(mp.id),
  );
  const busy = requestJoin.isPending || invite.isPending || cancel.isPending || accept.isPending || decline.isPending;

  return (
    <section aria-label="Your actions">
      {error && <p role="alert">{friendlyError(error)}</p>}

      {post.myPending.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {post.myPending.map((r) => (
            <li key={r.id}>
              {`${r.kind === 'invite' ? 'Invite' : 'Request'} pending: ${r.character.ign} `}
              {r.kind === 'invite' ? (
                // Only the inviting poster may cancel an invite; the invitee decides on it.
                <>
                  <button type="button" disabled={busy} onClick={() => run('accept', () => accept.mutate(r.id))}>
                    Accept
                  </button>
                  <button type="button" disabled={busy} onClick={() => run('decline', () => decline.mutate(r.id))}>
                    Decline
                  </button>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={() => run('cancel', () => cancel.mutate(r.id))}>
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {post.sentInvitesToThis.length > 0 && (
        <ul aria-label="Invites you sent" style={{ listStyle: 'none', padding: 0 }}>
          {post.sentInvitesToThis.map((r) => (
            <li key={r.id}>
              {`Invite sent from ${r.post.bosses.map(bossLabel).join(', ')} `}
              <button type="button" disabled={busy} onClick={() => run('cancel', () => cancel.mutate(r.id))}>
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}

      {canRequest && (
        <div className="post-actions">
          <button type="button" onClick={() => setPanel(panel === 'request' ? null : 'request')}>
            Request to join
          </button>
        </div>
      )}
      {canRequest &&
        panel === 'request' &&
        (characters.isLoading ? (
          <p>Loading…</p>
        ) : (
          <CharacterPicker
            characters={characters.data ?? []}
            worldId={post.world.id}
            post={post}
            myParties={myParties.data ?? []}
            disabled={busy}
            onPick={(characterId) =>
              run('requestJoin', () =>
                requestJoin.mutate(characterId, {
                  onSuccess: () => setPanel(null),
                }),
              )
            }
          />
        ))}

      {canInvite && (
        <div className="post-actions">
          <button type="button" onClick={() => setPanel(panel === 'invite' ? null : 'invite')}>
            Invite
          </button>
        </div>
      )}
      {canInvite &&
        panel === 'invite' &&
        (inviteTargets.length === 0 ? (
          <p>{`You have no open recruiting posts on ${post.world.name}.`}</p>
        ) : (
          <ul aria-label="Your open recruiting posts" style={{ listStyle: 'none', padding: 0 }}>
            {inviteTargets.map((mp) => (
              <li key={mp.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run('invite', () => invite.mutate(mp.id, { onSuccess: () => setPanel(null) }))}
                >
                  {postLabel(mp)}
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
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
  const bossContext = post.bosses.map((b) => ({
    bossDifficultyId: b.bossDifficultyId,
    label: bossLabel(b),
  }));
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
              {post.minCp !== null && r.character.combatPower < post.minCp && (
                <span className="post-warn">Below min CP</span>
              )}
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
    const notFound = post.error instanceof ApiError && post.error.status === 404;
    return <p role="alert">{notFound ? "This post isn't available." : friendlyError(post.error)}</p>;
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
    <article>
      <header className="post-detail__head">
        <span className={`post-badge post-badge--${p.type}`}>{POST_TYPE_LABELS[p.type]}</span>
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
        <div className="post-actions">
          {posterActive && <Link to={`/posts/${p.id}/edit`}>Edit</Link>}
          {posterActive && (
            <button type="button" disabled={close.isPending} onClick={() => run('close', () => close.mutate())}>
              Close
            </button>
          )}
          {p.canRenew && (
            <button type="button" disabled={renew.isPending} onClick={() => run('renew', () => renew.mutate())}>
              Renew
            </button>
          )}
          <button type="button" disabled={del.isPending} onClick={onDelete}>
            Delete
          </button>
        </div>
      )}

      <h2>Lineup</h2>
      <LineupView
        post={p}
        tiers={tierList}
        onRemove={posterActive ? (memberId) => run('remove', () => remove.mutate(memberId)) : undefined}
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
                disabled={accept.isPending || decline.isPending}
                onClick={() => run('accept', () => accept.mutate(r.id))}
              >
                Accept
              </button>
              <button
                type="button"
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
            <button type="button" disabled={cancel.isPending} onClick={() => run('cancel', () => cancel.mutate(r.id))}>
              Cancel
            </button>
          )}
        />
      )}

      {p.receivedInvites.length > 0 && (
        <section aria-label="Invites received">
          <h2>Invites received</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {p.receivedInvites.map((r) => (
              <li key={r.id}>
                <Link to={`/posts/${r.postId}`}>{postLabel(r.post)}</Link>{' '}
                <button
                  type="button"
                  disabled={accept.isPending || decline.isPending}
                  onClick={() => run('accept', () => accept.mutate(r.id, { onSuccess: () => navigate(`/posts/${r.postId}`) }))}
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={accept.isPending || decline.isPending}
                  onClick={() => run('decline', () => decline.mutate(r.id))}
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!p.isPoster && !p.deleted && <ViewerActions post={p} />}
    </article>
  );
}
