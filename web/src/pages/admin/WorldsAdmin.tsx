import { useState } from 'react';
import type { WorldDTO } from '@pf/shared';
import { useAdminWorlds, useCreateWorld, useDeleteWorld, useUpdateWorld, useWorldUsage } from '../../api/hooks';
import { ApiError } from '../../api/client';
import { friendlyError } from '../../api/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { plural } from '../../lib/plural';

interface Draft {
  id: number | null;
  nexonWorldId: string;
  name: string;
  worldType: WorldDTO['worldType'];
}

function DeleteWorldDialog({ world, onClose }: { world: WorldDTO; onClose: () => void }) {
  const usage = useWorldUsage(world.id);
  const del = useDeleteWorld();
  const u = usage.data;
  const igns = del.error instanceof ApiError && Array.isArray(del.error.details.igns) ? (del.error.details.igns as string[]) : [];
  return (
    <ConfirmDialog
      title={`Delete ${world.name}?`}
      confirmLabel="Delete world"
      confirmDisabled={!u}
      busy={del.isPending}
      error={usage.isError ? friendlyError(usage.error) : del.isError ? friendlyError(del.error) : undefined}
      onConfirm={() => del.mutate(world.id, { onSuccess: onClose })}
      onCancel={onClose}
    >
      {u ? <p>{plural(u.characters, 'character')} and {plural(u.posts, 'post')} will move to Kronos.</p> : <p>Checking what this affects…</p>}
      {igns.length > 0 && (
        <ul>
          {igns.map((ign) => <li key={ign}>{ign}</li>)}
        </ul>
      )}
    </ConfirmDialog>
  );
}

const blank: Draft = { id: null, nexonWorldId: '', name: '', worldType: 'heroic' };

export function WorldsAdmin() {
  const worlds = useAdminWorlds();
  const create = useCreateWorld();
  const update = useUpdateWorld();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<WorldDTO | null>(null);
  const mutation = draft?.id != null ? update : create;

  const open = (d: Draft) => {
    create.reset();
    update.reset();
    setDraft(d);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const opts = { onSuccess: () => setDraft(null) };
    if (draft.id != null) update.mutate({ id: draft.id, name: draft.name, worldType: draft.worldType }, opts);
    else create.mutate({ nexonWorldId: Number(draft.nexonWorldId), name: draft.name, worldType: draft.worldType }, opts);
  }

  return (
    <div>
      <h2>Worlds</h2>
      {worlds.isError && <p role="alert" className="admin__error">{friendlyError(worlds.error)}</p>}
      <button type="button" className="btn btn--secondary" onClick={() => open(blank)}>Add world</button>
      <table className="admin__table">
        <thead>
          <tr><th>Nexon ID</th><th>Name</th><th>Type</th><th>Active</th><th /></tr>
        </thead>
        <tbody>
          {worlds.data?.map((w) => (
            <tr key={w.id}>
              <td data-label="Nexon ID">{w.nexonWorldId}</td>
              <td data-label="Name">{w.name}</td>
              <td data-label="Type">{w.worldType === 'heroic' ? 'Heroic' : 'Interactive'}</td>
              <td data-label="Active">
                <input
                  type="checkbox"
                  aria-label={`Active ${w.name}`}
                  checked={w.active}
                  onChange={(e) => update.mutate({ id: w.id, active: e.target.checked })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn--secondary"
                  aria-label={`Edit ${w.name}`}
                  onClick={() => open({ id: w.id, nexonWorldId: String(w.nexonWorldId), name: w.name, worldType: w.worldType })}
                >
                  Edit
                </button>
                {w.name.toLowerCase() !== 'kronos' && (
                  <button type="button" className="btn btn--danger" aria-label={`Delete ${w.name}`} onClick={() => setDeleting(w)}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {update.isError && !draft && <p role="alert" className="admin__error">{friendlyError(update.error)}</p>}

      {deleting && <DeleteWorldDialog world={deleting} onClose={() => setDeleting(null)} />}

      {draft && (
        <form className="admin__form" onSubmit={submit}>
          <label>
            Nexon world ID
            <input
              type="number"
              required
              disabled={draft.id != null}
              value={draft.nexonWorldId}
              onChange={(e) => setDraft({ ...draft, nexonWorldId: e.target.value })}
            />
          </label>
          <label>
            Name
            <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            Type
            <select value={draft.worldType} onChange={(e) => setDraft({ ...draft, worldType: e.target.value as Draft['worldType'] })}>
              <option value="heroic">Heroic</option>
              <option value="interactive">Interactive</option>
            </select>
          </label>
          {mutation.isError && <p role="alert" className="admin__error">{friendlyError(mutation.error)}</p>}
          <div className="admin__row">
            <button type="submit" className="btn btn--primary" disabled={mutation.isPending}>{draft.id != null ? 'Save world' : 'Create world'}</button>
            <button type="button" className="btn btn--secondary" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
