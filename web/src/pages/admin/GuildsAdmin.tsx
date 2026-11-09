import { useState } from 'react';
import type { AdminGuildDTO } from '@pf/shared';
import { useAdminGuilds, useAdminWorlds, useCreateGuild, useUpdateGuild } from '../../api/hooks';
import { friendlyError } from '../../api/errors';

interface Draft {
  id: string | null;
  name: string;
  iconUrl: string;
  webhookUrl: string;
  worldIds: number[];
}

const blank: Draft = { id: null, name: '', iconUrl: '', webhookUrl: '', worldIds: [] };

export function GuildsAdmin() {
  const guilds = useAdminGuilds();
  const worlds = useAdminWorlds();
  const create = useCreateGuild();
  const update = useUpdateGuild();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHook, setShowHook] = useState(false);
  const mutation = draft?.id ? update : create;

  const worldName = (id: number) => worlds.data?.find((w) => w.id === id)?.name ?? String(id);
  const open = (d: Draft) => {
    create.reset();
    update.reset();
    setShowHook(false);
    setDraft(d);
  };
  const edit = (g: AdminGuildDTO) =>
    open({ id: g.id, name: g.name, iconUrl: g.iconUrl ?? '', webhookUrl: g.webhookUrl ?? '', worldIds: g.worldIds });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const payload = {
      name: draft.name,
      iconUrl: draft.iconUrl.trim() || null,
      webhookUrl: draft.webhookUrl.trim() || null,
      worldIds: draft.worldIds,
    };
    const opts = { onSuccess: () => setDraft(null) };
    if (draft.id) update.mutate({ id: draft.id, ...payload }, opts);
    else create.mutate(payload, opts);
  }

  return (
    <div>
      <h2>Guilds</h2>
      {guilds.isError && <p role="alert" className="admin__error">{friendlyError(guilds.error)}</p>}
      <button type="button" onClick={() => open(blank)}>Add guild</button>
      <table className="admin__table">
        <thead>
          <tr><th>Name</th><th>Worlds</th><th>Webhook</th><th>Active</th><th /></tr>
        </thead>
        <tbody>
          {guilds.data?.map((g) => (
            <tr key={g.id}>
              <td data-label="Name">{g.name}</td>
              <td data-label="Worlds">{g.worldIds.map(worldName).join(', ') || '—'}</td>
              <td data-label="Webhook">{g.webhookUrl ? '✓' : '—'}</td>
              <td data-label="Active">
                <input
                  type="checkbox"
                  aria-label={`Active ${g.name}`}
                  checked={g.active}
                  onChange={(e) => update.mutate({ id: g.id, active: e.target.checked })}
                />
              </td>
              <td><button type="button" aria-label={`Edit ${g.name}`} onClick={() => edit(g)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {update.isError && !draft && <p role="alert" className="admin__error">{friendlyError(update.error)}</p>}

      {draft && (
        <form className="admin__form" onSubmit={submit}>
          <label>
            Name
            <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            Icon URL
            <input value={draft.iconUrl} onChange={(e) => setDraft({ ...draft, iconUrl: e.target.value })} />
          </label>
          <div className="admin__row">
            <label>
              Webhook URL
              <input
                type={showHook ? 'text' : 'password'}
                autoComplete="off"
                value={draft.webhookUrl}
                onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
              />
            </label>
            <button type="button" onClick={() => setShowHook((s) => !s)}>{showHook ? 'Hide' : 'Show'}</button>
          </div>
          <fieldset className="admin__checks">
            <legend>Worlds</legend>
            {worlds.data?.map((w) => (
              <label key={w.id}>
                <input
                  type="checkbox"
                  checked={draft.worldIds.includes(w.id)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      worldIds: e.target.checked ? [...draft.worldIds, w.id] : draft.worldIds.filter((x) => x !== w.id),
                    })
                  }
                />
                {w.name}
              </label>
            ))}
          </fieldset>
          {mutation.isError && <p role="alert" className="admin__error">{friendlyError(mutation.error)}</p>}
          <div className="admin__row">
            <button type="submit" disabled={mutation.isPending}>{draft.id ? 'Save guild' : 'Create guild'}</button>
            <button type="button" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
