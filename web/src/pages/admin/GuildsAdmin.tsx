import { useState } from 'react';
import type { AdminGuildDTO } from '@pf/shared';
import { useAdminGuilds, useAdminWorlds, useBosses, useCreateGuild, useDeleteGuild, useGuildUsage, useTestWebhook, useUpdateGuild } from '../../api/hooks';
import { friendlyError } from '../../api/errors';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { plural } from '../../lib/plural';

interface Draft {
  id: string | null;
  name: string;
  iconUrl: string;
  webhookUrl: string;
  partyForumWebhookUrl: string;
  worldIds: number[];
  bossRoleIds: Record<string, string>;
}

function TestWebhookButton({ guild }: { guild: AdminGuildDTO }) {
  const test = useTestWebhook();
  const data = test.data;
  return (
    <>
      <button type="button" className="btn btn--secondary" aria-label={`Send test message ${guild.name}`} disabled={test.isPending} onClick={() => test.mutate(guild.id)}>
        Send test message
      </button>
      {data?.ok === true && <span role="status"> Sent ✓</span>}
      {data?.ok === false && <span role="alert" className="admin__error"> Failed: {data.error}</span>}
      {test.isError && <span role="alert" className="admin__error"> {friendlyError(test.error)}</span>}
    </>
  );
}

function DeleteGuildDialog({ guild, onClose }: { guild: AdminGuildDTO; onClose: () => void }) {
  const usage = useGuildUsage(guild.id);
  const del = useDeleteGuild();
  const u = usage.data;
  return (
    <ConfirmDialog
      title={`Delete ${guild.name}?`}
      confirmLabel="Delete guild"
      confirmDisabled={!u}
      busy={del.isPending}
      error={usage.isError ? friendlyError(usage.error) : del.isError ? friendlyError(del.error) : undefined}
      onConfirm={() => del.mutate(guild.id, { onSuccess: onClose })}
      onCancel={onClose}
    >
      {u ? (
        <p>{plural(u.characters, 'character')} will have no guild and {u.posts} {u.posts === 1 ? 'post will lose it as its' : 'posts will lose it as their'} Discord destination.</p>
      ) : (
        <p>Checking what this affects…</p>
      )}
    </ConfirmDialog>
  );
}

const ROLE_ID = /^[1-9][0-9]{16,19}$/;

const blank: Draft = { id: null, name: '', iconUrl: '', webhookUrl: '', partyForumWebhookUrl: '', worldIds: [], bossRoleIds: {} };

export function GuildsAdmin() {
  const guilds = useAdminGuilds();
  const worlds = useAdminWorlds();
  const bosses = useBosses();
  const create = useCreateGuild();
  const update = useUpdateGuild();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHook, setShowHook] = useState(false);
  const [showForumHook, setShowForumHook] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<AdminGuildDTO | null>(null);
  const mutation = draft?.id ? update : create;

  const worldName = (id: number) => worlds.data?.find((w) => w.id === id)?.name ?? String(id);
  const open = (d: Draft) => {
    create.reset();
    update.reset();
    setShowHook(false);
    setShowForumHook(false);
    setFormError('');
    setDraft(d);
  };
  const edit = (g: AdminGuildDTO) =>
    open({ id: g.id, name: g.name, iconUrl: g.iconUrl ?? '', webhookUrl: g.webhookUrl ?? '', partyForumWebhookUrl: g.partyForumWebhookUrl ?? '', worldIds: g.worldIds, bossRoleIds: g.bossRoleIds ?? {} });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setFormError('');
    // Checked here, not with an input pattern: the inputs sit in a collapsible section, and the
    // browser silently blocks submit on an invalid field it cannot show.
    const badBoss = bosses.data?.find((boss) => {
      const roleId = draft.bossRoleIds[boss.id]?.trim();
      return roleId && !ROLE_ID.test(roleId);
    });
    if (badBoss) return setFormError(`${badBoss.name} role ID must be a Discord role ID (17–20 digits).`);
    const payload = {
      name: draft.name,
      iconUrl: draft.iconUrl.trim() || null,
      webhookUrl: draft.webhookUrl.trim() || null,
      ...(draft.partyForumWebhookUrl.trim() || draft.id ? { partyForumWebhookUrl: draft.partyForumWebhookUrl.trim() || null } : {}),
      worldIds: draft.worldIds,
      ...(bosses.data ? { bossRoleIds: Object.fromEntries(bosses.data.flatMap((boss) => {
        const roleId = draft.bossRoleIds[boss.id]?.trim();
        return roleId ? [[String(boss.id), roleId]] : [];
      })) } : {}),
    };
    const opts = { onSuccess: () => setDraft(null) };
    if (draft.id) update.mutate({ id: draft.id, ...payload }, opts);
    else create.mutate(payload, opts);
  }

  return (
    <div>
      <h2>Guilds</h2>
      {guilds.isError && <p role="alert" className="admin__error">{friendlyError(guilds.error)}</p>}
      <button type="button" className="btn btn--secondary" onClick={() => open(blank)}>Add guild</button>
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
              <td><button type="button" className="btn btn--secondary" aria-label={`Edit ${g.name}`} onClick={() => edit(g)}>Edit</button>
                {g.webhookUrl && <TestWebhookButton guild={g} />}
                <button type="button" className="btn btn--danger" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {update.isError && !draft && <p role="alert" className="admin__error">{friendlyError(update.error)}</p>}

      {deleting && <DeleteGuildDialog guild={deleting} onClose={() => setDeleting(null)} />}

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
          <div className="admin__webhook-row">
            <label>
              Boss channel webhook URL
              <input
                type={showHook ? 'text' : 'password'}
                autoComplete="off"
                value={draft.webhookUrl}
                onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
              />
            </label>
            <button type="button" className="btn btn--secondary" aria-label={`${showHook ? 'Hide' : 'Show'} boss channel webhook URL`} aria-pressed={showHook} onClick={() => setShowHook((s) => !s)}>{showHook ? 'Hide' : 'Show'}</button>
          </div>
          <div className="admin__webhook-row">
            <label>
              Party forum webhook URL
              <input type={showForumHook ? 'text' : 'password'} autoComplete="off" value={draft.partyForumWebhookUrl} onChange={(e) => setDraft({ ...draft, partyForumWebhookUrl: e.target.value })} />
            </label>
            <button type="button" className="btn btn--secondary" aria-label={`${showForumHook ? 'Hide' : 'Show'} party forum URL`} aria-pressed={showForumHook} onClick={() => setShowForumHook((s) => !s)}>{showForumHook ? 'Hide' : 'Show'}</button>
          </div>
          <small>Use a webhook for the Discord forum where finalized parties should get a thread.</small>
          <details className="admin__boss-roles">
            <summary>Boss role pings</summary>
            <p>New posts ping the roles for their bosses in this Discord server. Paste a role ID for each boss, or leave blank for no ping. All difficulties use the same role.</p>
            <p>In Discord, enable Developer Mode, then right-click a role and choose Copy Role ID. Enable “Allow anyone to @mention this role” for these roles.</p>
            {bosses.isPending && <p>Loading bosses…</p>}
            {bosses.isError && <p role="alert">{friendlyError(bosses.error)}</p>}
            {bosses.data?.map((boss) => (
              <label key={boss.id}>
                {boss.name} role ID
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={20}
                  placeholder="Discord role ID"
                  value={draft.bossRoleIds[boss.id] ?? ''}
                  onChange={(event) => setDraft({ ...draft, bossRoleIds: { ...draft.bossRoleIds, [boss.id]: event.target.value } })}
                />
              </label>
            ))}
          </details>
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
          {formError && <p role="alert" className="admin__error">{formError}</p>}
          {mutation.isError && <p role="alert" className="admin__error">{friendlyError(mutation.error)}</p>}
          <div className="admin__row">
            <button type="submit" className="btn btn--primary" disabled={mutation.isPending}>{draft.id ? 'Save guild' : 'Create guild'}</button>
            <button type="button" className="btn btn--secondary" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
