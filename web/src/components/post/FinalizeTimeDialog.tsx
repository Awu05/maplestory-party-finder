import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, SyntheticEvent } from 'react';
import type { PostDetailDTO } from '@pf/shared';
import { friendlyError } from '../../api/errors';
import { useFinalizeTime } from '../../api/postHooks';
import { localInputToUtcIso, utcIsoToLocalInput } from './time';
import '../character/character.css';

interface Props {
  post: PostDetailDTO;
  onClose: () => void;
}

export function FinalizeTimeDialog({ post, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const finalize = useFinalizeTime(post.id);
  const [value, setValue] = useState(post.scheduledAt ? utcIsoToLocalInput(post.scheduledAt) : '');
  const [error, setError] = useState('');

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

  const submit = () => {
    if (!value) return;
    setError('');
    finalize.mutate(localInputToUtcIso(value), { onSuccess: onClose, onError: (e) => setError(friendlyError(e)) });
  };

  return (
    <dialog
      ref={ref}
      className="move-dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onCancel={onCancel}
      onClick={onDialogClick}
    >
      <div className="move-dialog__content">
        <h2 id={headingId}>{post.scheduledAt ? 'Change time' : 'Finalize time'}</h2>
        <label className="move-dialog__field">
          Final time
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={!value || finalize.isPending} onClick={submit}>
            Save
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
