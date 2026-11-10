import { forwardRef } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { POST_TYPE_LABELS } from '@pf/shared';
import type { PostSummaryDTO } from '@pf/shared';
import { bossLabel } from './labels';
import { formatWhen } from './time';
import './post.css';

interface Props {
  post: PostSummaryDTO;
  selected: boolean;
  onSelect: () => void;
  /** Phone mode: a plain link that navigates. Otherwise a listbox option that selects on plain left-click. */
  asLink: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement>) => void;
}

const isPlainLeftClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const PostRow = forwardRef<HTMLAnchorElement, Props>(function PostRow(
  { post, selected, onSelect, asLink, onKeyDown },
  ref,
) {
  const { poster } = post;
  const ign = poster.character?.ign ?? poster.snapshot.ign;
  const sprite = poster.character?.imageUrl ?? poster.snapshot.imageUrl;
  const slots = post.type === 'recruiting' && post.partySize ? { have: post.memberCount, of: post.partySize } : null;

  const optionProps = asLink
    ? {}
    : {
        role: 'option',
        'aria-selected': selected,
        tabIndex: selected ? 0 : -1,
        onKeyDown,
        onClick: (e: MouseEvent<HTMLAnchorElement>) => {
          if (!isPlainLeftClick(e)) return;
          e.preventDefault();
          onSelect();
        },
      };

  return (
    <Link ref={ref} to={`/posts/${post.id}`} className="post-row" {...optionProps}>
      {sprite ? (
        <img className="post-row__sprite" src={sprite} alt="" width={40} height={40} />
      ) : (
        <span className="post-row__sprite" aria-hidden="true" />
      )}
      <span className="post-row__body">
        <span className="post-row__top">
          <span className={`post-badge post-badge--${post.type}`}>{POST_TYPE_LABELS[post.type]}</span>
          <span className="post-row__bosses">{post.bosses.map(bossLabel).join(', ')}</span>
        </span>
        <span className="post-row__meta">
          <span className="post-row__when">{formatWhen(post.scheduledAt)}</span>
          <span className="post-row__who">{`${ign} · ${post.guild.name}`}</span>
        </span>
      </span>
      {slots && (
        <span className="post-row__slots">
          <span>{`${slots.have} / ${slots.of}`}</span>
          <span className="post-row__bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (slots.have / slots.of) * 100)}%` }} />
          </span>
        </span>
      )}
    </Link>
  );
});
