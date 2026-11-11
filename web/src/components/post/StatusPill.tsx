import type { PostStatus } from '@pf/shared';
import './post.css';

const STATUS_LABELS = { open: 'Open', full: 'Full', closed: 'Closed' } as const;

export function StatusPill({ status, deleted, recruitmentClosed = false }: { status: PostStatus; deleted: boolean; recruitmentClosed?: boolean }) {
  return (
    <span className={`post-pill post-pill--${deleted ? 'deleted' : status}`}>
      {deleted ? 'Deleted' : recruitmentClosed ? 'Recruitment closed' : STATUS_LABELS[status]}
    </span>
  );
}
