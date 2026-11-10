import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMe, useUpdateProfile } from '../api/hooks';
import { friendlyError } from '../api/errors';
import './characters.css';

export function ProfilePage() {
  const { data: me, isPending, error } = useMe();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState<string | null>(null);
  if (isPending) return <p>Loading profile…</p>;
  if (error) return <p role="alert">{friendlyError(error)}</p>;
  if (!me) return <p>Log in to edit your profile.</p>;

  function save(event: FormEvent) {
    event.preventDefault();
    update.mutate((draft ?? me?.displayName ?? '').trim() || null, { onSuccess: () => setDraft(null) });
  }

  return (
    <section>
      <h1>Profile</h1>
      <p>Discord: @{me.discordUsername}</p>
      <form className="char-form" onSubmit={save}>
        <label htmlFor="display-name">Display name
          <input id="display-name" value={draft ?? me.displayName ?? ''} maxLength={50} disabled={update.isPending} aria-describedby="display-name-help"
            onChange={(event) => { setDraft(event.target.value); update.reset(); }} />
        </label>
        <small id="display-name-help">Shown on your characters and party posts. Leave blank to use your Discord username.</small>
        {update.isError && <p role="alert">{friendlyError(update.error)}</p>}
        {update.isSuccess && <p role="status">Profile saved.</p>}
        <div className="actions">
          <button className="btn btn--primary" disabled={update.isPending} type="submit">{update.isPending ? 'Saving…' : 'Save'}</button>
          <Link className="btn btn--secondary" to="/">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
