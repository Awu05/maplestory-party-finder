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

/** Account popup opened from the header: edit the display name, or log out. */
export function ProfileDialog({ me, onClose, onLogout }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState(me.displayName ?? '');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>('input')?.focus();
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
    update.mutate(draft.trim() || null, { onSuccess: onClose });
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
        <p className="profile-dialog__muted">Discord: @{me.discordUsername}</p>
        <label className="profile-dialog__field">
          Display name
          <input
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
