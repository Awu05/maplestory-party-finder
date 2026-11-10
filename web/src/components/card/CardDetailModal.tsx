import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, SyntheticEvent } from 'react';
import { EXPERIENCE_LABELS } from '@pf/shared';
import type { CharacterDTO, RarityTierDTO } from '@pf/shared';
import { PlayTimeGrid } from '../PlayTimeGrid';
import { CharacterCard } from './CharacterCard';
import { cpUpdatedLabel } from './format';
import './card.css';

interface Props {
  character: CharacterDTO;
  tiers: RarityTierDTO[];
  onClose: () => void;
  onEdit?: () => void;
}

function groupBosses(bosses: CharacterDTO['bosses']) {
  const groups = new Map<string, CharacterDTO['bosses']>();
  for (const b of bosses) groups.set(b.bossName, [...(groups.get(b.bossName) ?? []), b]);
  return [...groups.entries()];
}

export function CardDetailModal({ character: c, tiers, onClose, onEdit }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  // Esc fires `cancel`; keep the dialog mounted/open state owned by the parent.
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };
  // The content wrapper fills the dialog, so a click landing on the dialog itself is on the backdrop.
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const copyUsername = async () => {
    try {
      await navigator.clipboard.writeText(c.owner.discordUsername);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="card-modal"
      aria-modal="true"
      aria-labelledby={headingId}
      onCancel={onCancel}
      onClick={onDialogClick}
    >
      <div className="card-modal__content">
        <button type="button" className="card-modal__close" onClick={onClose}>
          Close
        </button>

        <div className="card-modal__side">
          <CharacterCard character={c} tiers={tiers} />
          <section className="card-modal__screenshot">
            {c.screenshotUrl ? (
              <a href={c.screenshotUrl} target="_blank" rel="noopener noreferrer">
                <img src={c.screenshotUrl} alt={`${c.ign} Scouter screenshot`} />
              </a>
            ) : (
              <p className="card-modal__muted">No Scouter screenshot yet</p>
            )}
          </section>
        </div>

        <div className="card-modal__details">
          <header className="card-modal__header">
            <h2 id={headingId}>{c.ign}</h2>
            <div className="card-modal__muted">{cpUpdatedLabel(c.cpUpdatedAt)}</div>
          </header>

          {c.syncStatus === 'stale' && (
            <p className="card-modal__stale" role="status">
              Stale: couldn't sync from Nexon
            </p>
          )}

          <section>
            <h3>Discord</h3>
            <div className="card-modal__discord">
              <span>{c.owner.discordUsername}</span>
              <button type="button" className="btn btn--secondary btn--compact" onClick={copyUsername} aria-label="Copy Discord username">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </section>

          <section>
            <h3>Bosses</h3>
            {c.bosses.length === 0 ? (
              <p className="card-modal__muted">No bosses listed</p>
            ) : (
              <ul className="card-modal__bosses">
                {groupBosses(c.bosses).map(([bossName, entries]) => (
                  <li key={bossName}>
                    <strong>{bossName}</strong>
                    <ul>
                      {entries.map((b) => (
                        <li key={b.bossDifficultyId}>{`${b.difficulty}: ${EXPERIENCE_LABELS[b.experience]}`}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Play times (your time)</h3>
            {c.playTimes.length === 0 ? (
              <p className="card-modal__muted">No play times listed</p>
            ) : (
              <PlayTimeGrid value={c.playTimes} readOnly />
            )}
          </section>

          {c.note && (
            <section>
              <h3>Note</h3>
              <p className="card-modal__note">{c.note}</p>
            </section>
          )}

          {c.isOwner && onEdit && (
            <div className="card-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={onEdit}>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
