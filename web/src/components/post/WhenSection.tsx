import { useId } from 'react';
import { freeSlotsForViewer } from '@pf/shared';
import type { PostSummaryDTO } from '@pf/shared';
import { FreeTimeGrid } from './FreeTimeGrid';
import { browserTimeZone } from '../../lib/timeZone';
import { formatWhen } from './time';

/** For Recruiting, the final time (or "Time not set yet"); then the poster's free times, shown in the viewer's zone. */
export function WhenSection({ post, collapsible = false }: { post: PostSummaryDTO; collapsible?: boolean }) {
  const zone = post.freeTimesZone;
  // Old posts have no zone and no slots: never call freeSlotsForViewer with a null zone.
  const hasFree = post.freeTimes.length > 0 && zone !== null;
  const viewerZone = browserTimeZone();
  const summaryId = useId();
  const collapsed = collapsible && hasFree;
  const grid = hasFree ? (
    <>
      {/* Collapsed, the summary already says "Free times": the grid takes its name from it. */}
      <FreeTimeGrid
        value={freeSlotsForViewer(post.freeTimes, zone, viewerZone, new Date())}
        readOnly
        label="Free times"
        labelledBy={collapsed ? summaryId : undefined}
      />
      <p className="when-section__caption">{`Shown in your time zone (${viewerZone})`}</p>
    </>
  ) : (
    <p>Flexible</p>
  );
  return (
    <section className="when-section" aria-label="When">
      {/* LFP posts are never finalized: they only show the grid. */}
      {post.type === 'recruiting' && (
        <p className="when-section__final">
          {post.scheduledAt !== null ? `Final time: ${formatWhen(post.scheduledAt)}` : 'Time not set yet'}
        </p>
      )}
      {collapsed ? (
        <details>
          <summary id={summaryId}>Free times</summary>
          {grid}
        </details>
      ) : (
        grid
      )}
    </section>
  );
}
