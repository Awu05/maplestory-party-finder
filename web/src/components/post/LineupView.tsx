import { useState } from 'react';
import type { CharacterDTO, PartyMemberDTO, PostDetailDTO, RarityTierDTO } from '@pf/shared';
import { CharacterCard } from '../card/CharacterCard';
import { CardDetailModal } from '../card/CardDetailModal';
import { formatCp } from '../card/format';
import { bossLabel } from './labels';
import './post.css';

interface Props {
  post: PostDetailDTO;
  /** Not needed (and ignored) in compact mode. */
  tiers?: RarityTierDTO[];
  /** Small sprite thumbnails with IGN and dashed open slots: no CP captions, actions or card modal. */
  compact?: boolean;
  onRemove?: (memberId: string) => void;
  onLeave?: (memberId: string) => void;
  /** Disables Remove/Leave while a mutation is in flight. */
  busy?: boolean;
}

export function LineupView({ post, tiers = [], compact = false, onRemove, onLeave, busy = false }: Props) {
  const [open, setOpen] = useState<CharacterDTO | null>(null);
  const bossContext = post.bosses.map((b) => ({
    bossDifficultyId: b.bossDifficultyId,
    label: bossLabel(b),
  }));
  const showSlots = post.status !== 'closed' && !post.deleted;
  const emptySlots =
    showSlots && post.type === 'recruiting' && post.partySize !== null
      ? Math.max(0, post.partySize - post.members.length)
      : 0;

  const renderMember = (m: PartyMemberDTO) => {
    const c = m.character;
    return (
      <li key={m.id} className="lineup__item">
        {c ? (
          <CharacterCard character={c} tiers={tiers} bossContext={bossContext} onOpen={() => setOpen(c)} />
        ) : (
          <div className="post-card__fallback" role="figure" aria-label={`Deleted character ${m.snapshot.ign}`}>
            <img src={m.snapshot.imageUrl} alt="" width={48} height={48} />
            <div>
              <strong>Deleted character</strong>
              <div>
                {m.snapshot.ign} · Lv. {m.snapshot.level} {m.snapshot.jobName}
              </div>
            </div>
          </div>
        )}
        <div className="lineup__cp">
          {`CP at join ${formatCp(m.cpAtJoin)}`}
          {c && c.combatPower !== m.cpAtJoin && ` · now ${formatCp(c.combatPower)}`}
        </div>
        {m.role !== 'poster' && onRemove && (
          <button type="button" className="btn btn--danger btn--compact" disabled={busy} onClick={() => onRemove(m.id)}>
            Remove
          </button>
        )}
        {m.isMine && m.role !== 'poster' && onLeave && (
          <button type="button" className="btn btn--danger btn--compact" disabled={busy} onClick={() => onLeave(m.id)}>
            Leave
          </button>
        )}
      </li>
    );
  };

  if (compact) {
    return (
      <ul className="lineup lineup--compact" aria-label="Lineup">
        {post.members.map((m) => (
          <li key={m.id} className="lineup__thumb">
            <img src={m.character?.imageUrl ?? m.snapshot.imageUrl} alt="" width={48} height={48} />
            <span className="lineup__ign">{m.character?.ign ?? m.snapshot.ign}</span>
          </li>
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <li key={`slot-${i}`} className="lineup__thumb lineup__thumb--slot">
            Open slot
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <ul className="lineup">
        {post.members.map(renderMember)}
        {Array.from({ length: emptySlots }, (_, i) => (
          <li key={`slot-${i}`} className="lineup__slot">
            Open slot
          </li>
        ))}
      </ul>
      {open && <CardDetailModal character={open} tiers={tiers} onClose={() => setOpen(null)} />}
    </>
  );
}
