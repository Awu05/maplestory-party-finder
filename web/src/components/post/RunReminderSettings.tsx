import { useState } from 'react';
import { isValidReminderOffset, normalizeReminderOffsets } from '@pf/shared';
import { useUpdatePost } from '../../api/postHooks';
import { friendlyError } from '../../api/errors';
import { ReminderEditor } from '../ReminderEditor';

export function RunReminderSettings({ postId, offsets }: { postId: string; offsets: number[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(offsets);
  const update = useUpdatePost(postId);
  if (!editing) return <button type="button" className="btn btn--secondary" onClick={() => { setDraft(offsets); update.reset(); setEditing(true); }}>Edit reminders</button>;
  const invalid = draft.some((minutes) => !isValidReminderOffset(minutes));
  return <form aria-label="Run reminders" onSubmit={(e) => {
    e.preventDefault();
    if (invalid || update.isPending) return;
    update.mutate({ reminderOffsets: normalizeReminderOffsets(draft) }, { onSuccess: () => setEditing(false) });
  }}>
    <ReminderEditor value={draft} onChange={setDraft} disabled={update.isPending} />
    {update.isError && <p role="alert">{friendlyError(update.error)}</p>}
    <div className="actions">
      <button className="btn btn--primary" type="submit" disabled={invalid || update.isPending}>Save reminders</button>
      <button className="btn btn--secondary" type="button" disabled={update.isPending} onClick={() => setEditing(false)}>Cancel</button>
    </div>
  </form>;
}
