import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePost } from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { ApiError } from '../../api/client';
import { formatCp } from '../card/format';
import { LineupView } from './LineupView';
import { StatusPill } from './StatusPill';
import { ViewerActions } from './ViewerActions';
import { bossLabel } from './labels';
import { WhenSection } from './WhenSection';
import './post.css';

interface PostPreviewProps {
  postId: string | null;
  /** The board list is still loading: show the skeleton, not a prompt. */
  loading?: boolean;
  /** The post was deep-linked but is not in the current list. */
  outsideFilters?: boolean;
  /** Called with the id when an outside-filters post cannot be loaded (deleted, 404, other error). */
  onUnavailable?: (id: string) => void;
}

export function PostPreview({ postId, loading = false, outsideFilters = false, onUnavailable }: PostPreviewProps) {
  let body;
  if (postId !== null) {
    body = <PreviewBody key={postId} postId={postId} outsideFilters={outsideFilters} onUnavailable={onUnavailable} />;
  } else if (loading) {
    body = <Skeleton />;
  } else {
    body = <p className="board__placeholder">Pick a post to see its party</p>;
  }
  return (
    <section className="board__preview panel" aria-label="Post preview">
      {body}
    </section>
  );
}

const Skeleton = () => (
  <div className="post-preview__skeleton" role="status">
    <span className="visually-hidden">Loading post…</span>
  </div>
);

// Separate component so no (disabled) detail query is registered while nothing is selected;
// keyed by post id so action state (errors, open pickers) resets on selection change.
function PreviewBody({
  postId,
  outsideFilters,
  onUnavailable,
}: {
  postId: string;
  outsideFilters: boolean;
  onUnavailable?: (id: string) => void;
}) {
  const post = usePost(postId, { live: true });
  const unavailable = post.error instanceof ApiError && (post.error.status === 403 || post.error.status === 404);
  const failed = post.isError && (!post.data || unavailable);
  useEffect(() => {
    if (failed && outsideFilters) onUnavailable?.(postId);
  }, [failed, outsideFilters, postId]); // onUnavailable is the board's state setter (stable)

  let body;
  if (failed) {
    body = <p role="alert">{friendlyError(post.error)}</p>;
  } else if (!post.data) {
    body = <Skeleton />;
  } else {
    const p = post.data;
    body = (
      <>
        {outsideFilters && <p className="post-preview__filter-note">This post isn't in your current filters.</p>}
        <div className="post-preview__head">
          <h2 className="post-preview__title">{p.bosses.map(bossLabel).join(', ')}</h2>
          <StatusPill status={p.status} deleted={p.deleted} />
        </div>
        <p className="post-preview__meta">
          {[p.world.name, (p.guild?.name ?? 'No guild')].join(' · ')}
        </p>
        <WhenSection post={p} members={p.members} collapsible />
        {p.minCp !== null && <p className="post-preview__meta">{`Min CP ${formatCp(p.minCp)}`}</p>}
        {p.note && <p className="post-preview__note">{p.note}</p>}
        <LineupView post={p} compact />
        <div className="actions">
          <Link className="btn btn--secondary" to={`/posts/${p.id}`}>
            Open post
          </Link>
          {/* Same rule as the full page's posterActive: no editing a closed or deleted post. */}
          {p.isPoster && !p.deleted && p.status !== 'closed' && (
            <Link className="btn btn--secondary" to={`/posts/${p.id}/edit`}>
              Edit
            </Link>
          )}
        </div>
        {!p.isPoster && !p.deleted && <ViewerActions post={p} />}
      </>
    );
  }

  return body;
}
