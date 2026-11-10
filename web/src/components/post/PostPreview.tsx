import { Link } from 'react-router-dom';
import { usePost } from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { formatCp } from '../card/format';
import { LineupView } from './LineupView';
import { StatusPill } from './StatusPill';
import { ViewerActions } from './ViewerActions';
import { bossLabel } from './labels';
import { formatWhen } from './time';
import './post.css';

export function PostPreview({ postId }: { postId: string | null }) {
  return (
    <section className="board__preview panel" aria-label="Post preview">
      {postId === null ? <p className="board__placeholder">Pick a post to see its party</p> : <PreviewBody postId={postId} />}
    </section>
  );
}

// Separate component so no (disabled) detail query is registered while nothing is selected.
function PreviewBody({ postId }: { postId: string }) {
  const post = usePost(postId);

  let body;
  if (post.isError) {
    body = <p role="alert">{friendlyError(post.error)}</p>;
  } else if (!post.data) {
    body = (
      <div className="post-preview__skeleton" role="status">
        <span className="visually-hidden">Loading post…</span>
      </div>
    );
  } else {
    const p = post.data;
    body = (
      <>
        <div className="post-preview__head">
          <h2 className="post-preview__title">{p.bosses.map(bossLabel).join(', ')}</h2>
          <StatusPill status={p.status} deleted={p.deleted} />
        </div>
        <p className="post-preview__meta">
          {[formatWhen(p.scheduledAt), p.world.name, p.guild.name].join(' · ')}
        </p>
        {p.minCp !== null && <p className="post-preview__meta">{`Min CP ${formatCp(p.minCp)}`}</p>}
        {p.note && <p className="post-preview__note">{p.note}</p>}
        <LineupView post={p} compact />
        <div className="actions">
          <Link className="btn btn--secondary" to={`/posts/${p.id}`}>
            Open post
          </Link>
          {p.isPoster && (
            <Link className="btn btn--secondary" to={`/posts/${p.id}/edit`}>
              Edit
            </Link>
          )}
        </div>
        <ViewerActions post={p} />
      </>
    );
  }

  return body;
}
