import type { PostStatus } from '@pf/shared';
import './post.css';

const STATUS_LABELS = { open: 'Open', full: 'Full', closed: 'Closed' } as const;

export function StatusPill({ status, deleted }: { status: PostStatus; deleted: boolean }) {
  return (
    <span className={`post-pill post-pill--${deleted ? 'deleted' : status}`}>
      {deleted ? 'Deleted' : STATUS_LABELS[status]}
    </span>
  );
}
