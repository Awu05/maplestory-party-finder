import { useState } from 'react';
import type { PostDetailDTO, RarityTierDTO, RequestDTO } from '@pf/shared';
import { useCharacters, useMe } from '../../api/hooks';
import {
  useAcceptRequest,
  useCancelRequest,
  useDeclineRequest,
  useInvite,
  useMyParties,
  useMyPosts,
  useRequestJoin,
} from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { CharacterCard } from '../card/CharacterCard';
import { CharacterPicker } from './CharacterPicker';
import { bossLabel, postLabel } from './labels';
import { useLastActionError } from './useLastActionError';

export function ViewerActions({ post }: { post: PostDetailDTO }) {
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
  const characters = useCharacters(
    { mine: true },
    { enabled: canRequest && panel === 'request' },
  );
  const myParties = useMyParties();
  const myPosts = useMyPosts();
  const { error, run } = useLastActionError({
    requestJoin,
    invite,
    cancel,
    accept,
    decline,
  });

  if (isLoading) return null;
  if (!loggedIn) return <p>Log in with Discord to join.</p>;

  // A recruiting post that already has a pending invite to this LFP post is not offered again.
  const alreadyInvited = new Set(post.sentInvitesToThis.map((r) => r.postId));
  const inviteTargets = (myPosts.data ?? []).filter(
    (mp) =>
      mp.type === 'recruiting' &&
      mp.status === 'open' &&
      !mp.deleted &&
      mp.world.id === post.world.id &&
      !alreadyInvited.has(mp.id),
  );
  const busy =
    requestJoin.isPending ||
    invite.isPending ||
    cancel.isPending ||
    accept.isPending ||
    decline.isPending;

  return (
    <section className="viewer-actions" aria-label="Your actions">
      {error && <p role="alert">{friendlyError(error)}</p>}

      {post.myPending.length > 0 && (
        <ul className="post-requests">
          {post.myPending.map((r) => (
            <li key={r.id}>
              {`${r.kind === 'invite' ? 'Invite' : 'Request'} pending: ${r.character.ign} `}
              {r.kind === 'invite' ? (
                // Only the inviting poster may cancel an invite; the invitee decides on it.
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => run('accept', () => accept.mutate(r.id))}
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
                </div>
              ) : (
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy}
                    onClick={() => run('cancel', () => cancel.mutate(r.id))}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {post.sentInvitesToThis.length > 0 && (
        <ul
          aria-label="Invites you sent"
          className="post-requests"
        >
          {post.sentInvitesToThis.map((r) => (
            <li key={r.id}>
              {`Invite sent from ${r.post.bosses.map(bossLabel).join(', ')} `}
              <div className="actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() => run('cancel', () => cancel.mutate(r.id))}
                >
                  Cancel
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canRequest && (
        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setPanel(panel === 'request' ? null : 'request')}
          >
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
        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setPanel(panel === 'invite' ? null : 'invite')}
          >
            Invite
          </button>
        </div>
      )}
      {canInvite &&
        panel === 'invite' &&
        (inviteTargets.length === 0 ? (
          <p>{`You have no open recruiting posts on ${post.world.name}.`}</p>
        ) : (
          <ul
            aria-label="Your open recruiting posts"
            className="post-requests"
          >
            {inviteTargets.map((mp) => (
              <li key={mp.id}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy}
                  onClick={() =>
                    run('invite', () =>
                      invite.mutate(mp.id, { onSuccess: () => setPanel(null) }),
                    )
                  }
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

export function RequestList({
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
  return (
    <section aria-label={title}>
      <h2>{title}</h2>
      {requests.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul className="lineup">
          {requests.map((r) => (
            <li key={r.id} className="lineup__item">
              <CharacterCard character={r.character} tiers={tiers} />
              {post.minCp !== null && r.character.combatPower < post.minCp && (
                <span className="post-warn">Below min CP</span>
              )}
              <div className="actions">{actions(r)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
