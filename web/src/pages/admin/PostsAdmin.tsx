import { useState } from 'react';
import { POST_TYPE_LABELS } from '@pf/shared';
import { Link } from 'react-router-dom';
import { useAdminDeletePost, useAdminPosts, useDebouncedValue } from '../../api/hooks';
import { friendlyError } from '../../api/errors';
import { ChipGroup } from '../../components/ui/Chips';
import { StatusPill } from '../../components/post/StatusPill';
import { bossLabel } from '../../components/post/labels';
import { relativeTime } from '../../components/post/time';

const STATUSES = [
  ['all', 'All'],
  ['open', 'Open'],
  ['full', 'Full'],
  ['closed', 'Closed'],
  ['deleted', 'Deleted'],
] as const;

export function PostsAdmin() {
  const [status, setStatus] = useState<string>('all');
  const [q, setQ] = useState('');
  const posts = useAdminPosts(status, useDebouncedValue(q));
  const remove = useAdminDeletePost();

  return (
    <div>
      <h2>Posts</h2>
      <div className="admin__row">
        <ChipGroup label="Status" options={STATUSES.map(([value, label]) => ({ value, label }))} value={status} onChange={setStatus} />
        <input type="search" aria-label="Search IGN" placeholder="Search IGN" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {posts.isError && <p role="alert" className="admin__error">{friendlyError(posts.error)}</p>}
      {remove.isError && <p role="alert" className="admin__error">{friendlyError(remove.error)}</p>}
      <table className="admin__table">
        <thead>
          <tr><th>Type</th><th>Bosses</th><th>Poster</th><th>World</th><th>Status</th><th>Closed reason</th><th>Created</th><th /></tr>
        </thead>
        <tbody>
          {posts.data?.map((p) => {
            const ign = p.poster.snapshot.ign;
            return (
              <tr key={p.id}>
                <td data-label="Type">{POST_TYPE_LABELS[p.type]}</td>
                <td data-label="Bosses">{p.bosses.map(bossLabel).join(', ')}</td>
                <td data-label="Poster">{ign} ({p.posterDiscordUsername}{p.posterDiscordLinked ? '' : ', unverified'})</td>
                <td data-label="World">{p.world.name}</td>
                <td data-label="Status"><StatusPill status={p.status} deleted={p.deleted} /></td>
                <td data-label="Closed reason">{p.closedReason ?? '—'}</td>
                <td data-label="Created">{relativeTime(p.createdAt)}</td>
                <td data-label="Actions">
                  <div className="admin__post-actions">
                    <Link className="btn btn--secondary" to={`/posts/${p.id}`} aria-label={`View ${p.id}`}>View</Link>
                    <button
                      type="button"
                      className="btn btn--danger"
                      aria-label={`Delete permanently ${p.id}`}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Permanently delete this post by ${ign}? This cannot be undone.`)) remove.mutate(p.id);
                      }}
                    >
                      Delete permanently
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
