import { Link } from 'react-router-dom';
import { POST_TYPE_LABELS } from '@pf/shared';
import type { PostSummaryDTO, RarityTierDTO } from '@pf/shared';
import { CharacterCard } from '../card/CharacterCard';
import { formatCp } from '../card/format';
import { bossLabel } from './labels';
import { whenLabel } from './time';
import './post.css';

interface Props {
  post: PostSummaryDTO;
  tiers: RarityTierDTO[];
  onOpen?: () => void;
}

export function PostCard({ post, tiers, onOpen }: Props) {
  const { poster } = post;
  return (
    <Link to={`/posts/${post.id}`} className="post-card" onClick={onOpen}>
      <div className="post-card__head">
        <span className={`post-badge post-badge--${post.type}`}>{POST_TYPE_LABELS[post.type]}</span>
        <span className="post-card__when">{whenLabel(post)}</span>
      </div>
      {poster.character ? (
        <CharacterCard character={poster.character} tiers={tiers} />
      ) : (
        <div className="post-card__fallback">
          <img src={poster.snapshot.imageUrl} alt="" width={48} height={48} />
          <span>
            {poster.snapshot.ign} · Lv. {poster.snapshot.level} {poster.snapshot.jobName}
          </span>
        </div>
      )}
      <ul className="post-card__bosses">
        {post.bosses.map((b) => (
          <li key={b.bossDifficultyId}>{bossLabel(b)}</li>
        ))}
      </ul>
      <div className="post-card__meta">
        {post.world.name} · {post.guild.name}
      </div>
      {post.type === 'recruiting' && (
        <div className="post-card__slots">
          <span>{`${post.memberCount}/${post.partySize}`}</span>
          {post.minCp !== null && <span>{` · Min CP ${formatCp(post.minCp)}`}</span>}
        </div>
      )}
      {post.note && <p className="post-card__note">{post.note}</p>}
    </Link>
  );
}
