import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, SyntheticEvent } from 'react';
import { MAX_SCHEDULE_AHEAD_MS, type PostDetailDTO } from '@pf/shared';
import { friendlyError } from '../../api/errors';
import { useFinalizeTime } from '../../api/postHooks';
import { localInputToUtcIso, utcIsoToLocalInput } from './time';
import { browserTimeZone } from '../../lib/timeZone';
import './post.css';

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
  const [repeatWeekly, setRepeatWeekly] = useState(Boolean(post.weeklyTimeZone));
  const timeZone = browserTimeZone();
  // The server takes now (less a small tolerance) through 30 days ahead.
  const [limits] = useState(() => {
    const now = Date.now();
    return {
      min: utcIsoToLocalInput(new Date(now).toISOString()),
      max: utcIsoToLocalInput(new Date(now + MAX_SCHEDULE_AHEAD_MS).toISOString()),
    };
  });

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
    finalize.mutate({ scheduledAt: localInputToUtcIso(value), repeatWeekly, ...(repeatWeekly ? { timeZone } : {}) }, {
      onSuccess: onClose, onError: (e) => setError(friendlyError(e)),
    });
  };

  return (
    <dialog
      ref={ref}
      className="finalize-dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onCancel={onCancel}
      onClick={onDialogClick}
    >
      <div className="finalize-dialog__content">
        <h2 id={headingId}>{post.scheduledAt ? 'Change time' : 'Finalize time'}</h2>
        <label className="finalize-dialog__field">
          Final time
          <input
            type="datetime-local"
            value={value}
            min={limits.min}
            max={limits.max}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="finalize-dialog__repeat">
          <input type="checkbox" checked={repeatWeekly} disabled={finalize.isPending} onChange={(event) => setRepeatWeekly(event.target.checked)} />
          Repeat weekly
        </label>
        {repeatWeekly && (
          <p className="finalize-dialog__help">Repeats on the selected day and time in {timeZone}. Everyone currently in the party gets a Discord reminder when it starts. Close the party or turn this off to stop reminders.</p>
        )}
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
