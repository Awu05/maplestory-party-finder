import { useState } from 'react';
import type { AdminUserDTO, CharacterDTO } from '@pf/shared';
import {
  useAdminDeleteCharacter,
  useAdminUserCharacters,
  useAdminUsers,
  useDebouncedValue,
  useRarityTiers,
  useReassignCharacter,
  useSetBanned,
} from '../../api/hooks';
import { friendlyError } from '../../api/errors';
import { CharacterCard } from '../../components/card/CharacterCard';

function ReassignPanel({ character, ownerId, onDone }: { character: CharacterDTO; ownerId: string; onDone: () => void }) {
  const [q, setQ] = useState('');
  const users = useAdminUsers(useDebouncedValue(q));
  const reassign = useReassignCharacter();
  const choices = users.data?.filter((u) => u.id !== ownerId && !u.banned) ?? [];

  const choose = (u: AdminUserDTO) => {
    if (!window.confirm(`Reassign ${character.ign} to ${u.discordUsername}?`)) return;
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
        <button key={u.id} type="button" aria-label={`Choose ${u.discordUsername}`} disabled={reassign.isPending} onClick={() => choose(u)}>
          {u.discordUsername}
        </button>
      ))}
      {reassign.isError && <p role="alert" className="admin__error">{friendlyError(reassign.error)}</p>}
      <button type="button" onClick={onDone}>Cancel</button>
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
              <button type="button" aria-label={`Reassign ${c.ign}`} onClick={() => setReassigning(reassigning === c.id ? null : c.id)}>
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

export function UsersAdmin() {
  const [q, setQ] = useState('');
  const users = useAdminUsers(useDebouncedValue(q));
  const setBanned = useSetBanned();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h2>Users</h2>
      <input type="search" aria-label="Search users" placeholder="Search Discord username" value={q} onChange={(e) => setQ(e.target.value)} />
      {users.isError && <p role="alert" className="admin__error">{friendlyError(users.error)}</p>}
      {setBanned.isError && <p role="alert" className="admin__error">{friendlyError(setBanned.error)}</p>}
      {users.data?.map((u) => {
        const expanded = open === u.id;
        return (
          <div key={u.id} className="admin__user">
            <div className="admin__user-head">
              {u.avatarUrl ? <img className="admin__avatar" src={u.avatarUrl} alt="" /> : <span className="admin__avatar" aria-hidden="true" />}
              <strong>{u.discordUsername}</strong>
              {u.isAdmin && <span className="pill">Admin</span>}
              {u.banned && <span className="pill pill--red">Banned</span>}
              <span>{u.characterCount} {u.characterCount === 1 ? 'character' : 'characters'}</span>
              {!u.isAdmin && (
                <button
                  type="button"
                  className={u.banned ? undefined : 'btn btn--danger'}
                  aria-label={`${u.banned ? 'Unban' : 'Ban'} ${u.discordUsername}`}
                  disabled={setBanned.isPending}
                  onClick={() => {
                    if (!u.banned && !window.confirm(`Ban ${u.discordUsername}? Their open posts will close.`)) return;
                    setBanned.mutate({ id: u.id, banned: !u.banned });
                  }}
                >
                  {u.banned ? 'Unban' : 'Ban'}
                </button>
              )}
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Hide' : 'Show'} characters ${u.discordUsername}`}
                onClick={() => setOpen(expanded ? null : u.id)}
              >
                {expanded ? 'Hide characters' : 'Characters'}
              </button>
            </div>
            {expanded && <UserCharacters user={u} />}
          </div>
        );
      })}
    </div>
  );
}
