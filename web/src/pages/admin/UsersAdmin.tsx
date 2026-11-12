import { useState } from 'react';
import type { AdminUserDTO, CharacterDTO } from '@pf/shared';
import {
  useAdminDeleteCharacter,
  useAdminUserCharacters,
  useAdminUsers,
  useDeleteUser,
  useReactivateUser,
  type UserStatusFilter,
  useDebouncedValue,
  useRarityTiers,
  useReassignCharacter,
  useSetBanned,
} from '../../api/hooks';
import { friendlyError } from '../../api/errors';
import { accountName, discordHandle, DISCORD_NAME_NOT_SET } from '../../lib/discordName';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CharacterCard } from '../../components/card/CharacterCard';

function ReassignPanel({ character, ownerId, onDone }: { character: CharacterDTO; ownerId: string; onDone: () => void }) {
  const [q, setQ] = useState('');
  const users = useAdminUsers(useDebouncedValue(q));
  const reassign = useReassignCharacter();
  const choices = users.data?.filter((u) => u.id !== ownerId && !u.banned && !u.deletedAt) ?? [];

  const choose = (u: AdminUserDTO) => {
    const handle = u.discordLinked ? `@${u.discordUsername}` : `${u.discordUsername}, unverified`;
    const name = !u.discordUsername ? accountName(u) : u.displayName ? `${u.displayName} (${handle})` : u.discordLinked ? u.discordUsername : `${u.discordUsername} (unverified)`;
    if (!window.confirm(`Reassign ${character.ign} to ${name}?`)) return;
    reassign.mutate({ id: character.id, userId: u.id }, { onSuccess: onDone });
  };

  return (
    <div role="group" aria-label={`Reassign ${character.ign}`} className="admin__picker">
      <input
        type="search"
        aria-label="Search new owner"
        placeholder="Search users"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {choices.map((u) => (
        <button key={u.id} type="button" className="btn btn--secondary" aria-label={`Choose ${accountName(u)}`} disabled={reassign.isPending} onClick={() => choose(u)}>
          {accountName(u)}
        </button>
      ))}
      {reassign.isError && <p role="alert" className="admin__error">{friendlyError(reassign.error)}</p>}
      <button type="button" className="btn btn--secondary" onClick={onDone}>Cancel</button>
    </div>
  );
}

function UserCharacters({ user }: { user: AdminUserDTO }) {
  const chars = useAdminUserCharacters(user.id, true);
  const tiers = useRarityTiers();
  const remove = useAdminDeleteCharacter();
  const [reassigning, setReassigning] = useState<string | null>(null);

  return (
    <div>
      {chars.isError && <p role="alert" className="admin__error">{friendlyError(chars.error)}</p>}
      {remove.isError && <p role="alert" className="admin__error">{friendlyError(remove.error)}</p>}
      {chars.data?.length === 0 && <p>No characters.</p>}
      <div className="admin__chars">
        {chars.data?.map((c) => (
          <div key={c.id} className="admin__char">
            <CharacterCard character={c} tiers={tiers.data ?? []} />
            <div className="admin__row">
              <button type="button" className="btn btn--secondary" aria-label={`Reassign ${c.ign}`} onClick={() => setReassigning(reassigning === c.id ? null : c.id)}>
                Reassign…
              </button>
              <button
                type="button"
                className="btn btn--danger"
                aria-label={`Delete ${c.ign}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${c.ign}? This cannot be undone.`)) remove.mutate(c.id);
                }}
              >
                Delete
              </button>
            </div>
            {reassigning === c.id && (
              <ReassignPanel character={c} ownerId={user.id} onDone={() => setReassigning(null)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DeleteUserDialog({ user, onClose }: { user: AdminUserDTO; onClose: () => void }) {
  const del = useDeleteUser();
  return (
    <ConfirmDialog
      title={`Delete ${accountName(user)}?`}
      confirmLabel="Delete account"
      busy={del.isPending}
      error={del.isError ? friendlyError(del.error) : undefined}
      onConfirm={() => del.mutate(user.id, { onSuccess: onClose })}
      onCancel={onClose}
    >
      <p>They won't be able to sign in and their open posts will close. You can reactivate the account later.</p>
    </ConfirmDialog>
  );
}

export function UsersAdmin() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserStatusFilter>('all');
  const users = useAdminUsers(useDebouncedValue(q), status);
  const setBanned = useSetBanned();
  const reactivate = useReactivateUser();
  const [deleting, setDeleting] = useState<AdminUserDTO | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h2>Users</h2>
      <input type="search" aria-label="Search users" placeholder="Search display name or Discord username" value={q} onChange={(e) => setQ(e.target.value)} />
      <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as UserStatusFilter)}>
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="deleted">Deleted</option>
      </select>
      {users.isError && <p role="alert" className="admin__error">{friendlyError(users.error)}</p>}
      {reactivate.isError && <p role="alert" className="admin__error">{friendlyError(reactivate.error)}</p>}
      {setBanned.isError && <p role="alert" className="admin__error">{friendlyError(setBanned.error)}</p>}
      {users.data?.map((u) => {
        const expanded = open === u.id;
        return (
          <div key={u.id} className="admin__user">
            <div className="admin__user-head">
              {u.avatarUrl ? <img className="admin__avatar" src={u.avatarUrl} alt="" /> : <span className="admin__avatar" aria-hidden="true" />}
              <strong>{accountName(u)}</strong>
              {u.displayName && <small>{discordHandle(u) ?? DISCORD_NAME_NOT_SET}</small>}
              {!u.discordLinked && u.discordUsername && <small className="unverified-note" title="Typed at sign-up and not confirmed through Discord">unverified</small>}
              {u.isAdmin && <span className="pill">Admin</span>}
              {u.banned && <span className="pill pill--red">Banned</span>}
              {u.deletedAt && <span className="pill pill--red">Deleted</span>}
              <span>{u.characterCount} {u.characterCount === 1 ? 'character' : 'characters'}</span>
              {u.deletedAt && (
                <button type="button" className="btn btn--secondary" aria-label={`Reactivate ${accountName(u)}`} disabled={reactivate.isPending} onClick={() => reactivate.mutate(u.id)}>
                  Reactivate
                </button>
              )}
              {!u.isAdmin && !u.deletedAt && (
                <button type="button" className="btn btn--danger" aria-label={`Delete account ${accountName(u)}`} onClick={() => setDeleting(u)}>
                  Delete
                </button>
              )}
              {!u.isAdmin && (
                <button
                  type="button"
                  className={u.banned ? 'btn btn--secondary' : 'btn btn--danger'}
                  aria-label={`${u.banned ? 'Unban' : 'Ban'} ${u.discordUsername || accountName(u)}`}
                  disabled={setBanned.isPending}
                  onClick={() => {
                    if (!u.banned && !window.confirm(`Ban ${u.discordUsername || accountName(u)}? Their open posts will close.`)) return;
                    setBanned.mutate({ id: u.id, banned: !u.banned });
                  }}
                >
                  {u.banned ? 'Unban' : 'Ban'}
                </button>
              )}
              <button
                type="button"
                className="btn btn--secondary"
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Hide' : 'Show'} characters ${u.discordUsername || accountName(u)}`}
                onClick={() => setOpen(expanded ? null : u.id)}
              >
                {expanded ? 'Hide characters' : 'Characters'}
              </button>
            </div>
            {expanded && <UserCharacters user={u} />}
          </div>
        );
      })}
      {deleting && <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
