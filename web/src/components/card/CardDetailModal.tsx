import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, SyntheticEvent } from 'react';
import type { CharacterDTO, RarityTierDTO } from '@pf/shared';
import { CharacterCard } from './CharacterCard';
import { cpUpdatedLabel } from './format';
import { accountName, discordHandle, DISCORD_NAME_NOT_SET } from '../../lib/discordName';
import './card.css';

interface Props {
  character: CharacterDTO;
  tiers: RarityTierDTO[];
  onClose: () => void;
  onEdit?: () => void;
}

export function CardDetailModal({ character: c, tiers, onClose, onEdit }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [copied, setCopied] = useState(false);
  const [viewing, setViewing] = useState(false);
  const thumbButton = useRef<HTMLButtonElement>(null);
  const viewerClose = useRef<HTMLButtonElement>(null);
  const wasViewing = useRef(false);

  // Focus the viewer's Close when it opens, and return to the thumbnail when it closes.
  useEffect(() => {
    if (viewing) viewerClose.current?.focus();
    else if (wasViewing.current) thumbButton.current?.focus();
    wasViewing.current = viewing;
  }, [viewing]);

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
    // Escape closes the full-size screenshot first, then the popup.
    if (viewing) setViewing(false);
    else onClose();
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
              <button
                ref={thumbButton}
                type="button"
                className="card-modal__shot-button"
                aria-label="View Scouter screenshot full size"
                onClick={() => setViewing(true)}
              >
                <img src={c.screenshotUrl} alt={`${c.ign} Scouter screenshot`} />
              </button>
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
              <span>{accountName(c.owner)}</span>
              {c.owner.discordUsername ? (
                <>
                  <small className="card-modal__muted">{discordHandle(c.owner)}</small>
                  {!c.owner.discordLinked && <small className="unverified-note" title="Typed at sign-up and not confirmed through Discord">unverified</small>}
                  <button type="button" className="btn btn--secondary btn--compact" onClick={copyUsername} aria-label="Copy Discord username">
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </>
              ) : c.owner.displayName && <small className="card-modal__muted">{DISCORD_NAME_NOT_SET}</small>}
            </div>
          </section>

          {c.isOwner && onEdit && (
            <div className="card-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={onEdit}>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
      {viewing && c.screenshotUrl && (
        <div
          className="shot-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`${c.ign} Scouter screenshot`}
          onClick={(e) => {
            // Clicking the dim area around the image closes the viewer, not the popup.
            e.stopPropagation();
            if (e.target === e.currentTarget) setViewing(false);
          }}
        >
          <button
            ref={viewerClose}
            type="button"
            className="btn btn--secondary shot-viewer__close"
            aria-label="Close screenshot"
            onClick={() => setViewing(false)}
          >
            Close
          </button>
          <img src={c.screenshotUrl} alt={`${c.ign} Scouter screenshot`} />
        </div>
      )}
    </dialog>
  );
}
