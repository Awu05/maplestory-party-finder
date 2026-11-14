import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, MouseEvent, SyntheticEvent } from 'react';
import type { MeDTO } from '@pf/shared';
import { useUpdateProfile } from '../api/hooks';
import { friendlyError } from '../api/errors';
import './profile.css';

interface Props {
  me: NonNullable<MeDTO>;
  onClose: () => void;
  onLogout: () => void;
}

/** Account popup opened from the header: edit the display name (and a typed Discord name), link Discord, or log out. */
export function ProfileDialog({ me, onClose, onLogout }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState(me.displayName ?? '');
  const unlinked = me.discordLinked === false;
  const [nameDraft, setNameDraft] = useState(me.discordUsername);
  const [idDraft, setIdDraft] = useState(me.discordUserId ?? '');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    displayNameRef.current?.focus();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  function save(e: FormEvent) {
    e.preventDefault();
    const discordUsername = nameDraft.trim();
    // Only an unlinked account types its Discord name; an empty or unchanged field leaves it as is.
    const changedName = unlinked && discordUsername !== '' && discordUsername !== me.discordUsername;
    const discordUserId = idDraft.trim();
    const changedId = unlinked && discordUserId !== '' && discordUserId !== me.discordUserId;
    update.mutate({ displayName: draft.trim() || null, ...(changedName ? { discordUsername } : {}), ...(changedId ? { discordUserId } : {}) }, { onSuccess: onClose });
  }

  return (
    <dialog
      ref={ref}
      className="profile-dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onCancel={onCancel}
      onClick={onDialogClick}
    >
      <form className="profile-dialog__content" onSubmit={save}>
        <h2 id={headingId}>Profile</h2>
        {unlinked ? (
          <>
            <p className="profile-dialog__muted">Your Discord account is not linked. Add your Discord user ID to receive party pings.</p>
            <a className="btn btn--secondary" href="/api/auth/discord/link">Link Discord account</a>
            <small className="profile-dialog__muted">Linking verifies your Discord name and user ID.</small>
            <label className="profile-dialog__field">
              <span>Discord username <span className="unverified-note" title="Typed at sign-up and not confirmed through Discord">unverified</span></span>
              <input
                value={nameDraft}
                maxLength={50}
                autoComplete="off"
                disabled={update.isPending}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  update.reset();
                }}
              />
            </label>
            {me.discordUsername === '' && (
              <small className="profile-dialog__muted">Your Discord username was claimed by its owner. Enter a different one or link your Discord account.</small>
            )}
            <label className="profile-dialog__field">Discord user ID
              <input inputMode="numeric" autoComplete="off" maxLength={50} value={idDraft} disabled={update.isPending} aria-describedby={`${headingId}-discord-id-help`} onChange={(e) => { setIdDraft(e.target.value); update.reset(); }} />
            </label>
            <small id={`${headingId}-discord-id-help`} className="profile-dialog__muted">In Discord, turn on Settings → Advanced → Developer Mode, then right-click your name and choose Copy User ID.</small>
          </>
        ) : (
          <p className="profile-dialog__muted">{`Discord: @${me.discordUsername}`}</p>
        )}
        <label className="profile-dialog__field">
          Display name
          <input
            ref={displayNameRef}
            value={draft}
            maxLength={50}
            disabled={update.isPending}
            aria-describedby={`${headingId}-help`}
            onChange={(e) => {
              setDraft(e.target.value);
              update.reset();
            }}
          />
        </label>
        <small id={`${headingId}-help`} className="profile-dialog__muted">
          Shown on your characters and party posts. Leave blank to use your Discord username.
        </small>
        {update.isError && <p role="alert">{friendlyError(update.error)}</p>}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        <hr className="profile-dialog__rule" />
        <button type="button" className="btn btn--danger profile-dialog__logout" onClick={onLogout}>
          Log out
        </button>
      </form>
    </dialog>
  );
}
