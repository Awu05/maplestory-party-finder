import { useState } from 'react';
import type { JobClassDTO } from '@pf/shared';
import { useClasses, useCreateClass, useDeleteClass, useUpdateClass } from '../../api/hooks';
import { friendlyError } from '../../api/errors';

type Arch = JobClassDTO['archetype'];

const ARCHETYPES: [Arch, string][] = [
  ['warrior', 'Warrior'],
  ['magician', 'Magician'],
  ['bowman', 'Bowman'],
  ['thief', 'Thief'],
  ['pirate', 'Pirate'],
  ['xenon', 'Xenon'],
];

function ArchetypeOptions() {
  return (
    <>
      {ARCHETYPES.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </>
  );
}

export function ClassesAdmin() {
  const classes = useClasses();
  const create = useCreateClass();
  const update = useUpdateClass();
  const remove = useDeleteClass();
  const [name, setName] = useState('');
  const [archetype, setArchetype] = useState<Arch>('warrior');
  const error = create.error ?? update.error ?? remove.error ?? (classes.isError ? classes.error : null);
  const sorted = [...(classes.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  function add(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({ name: name.trim(), archetype }, { onSuccess: () => setName('') });
  }

  return (
    <div>
      <h2>Classes</h2>
      {error && <p role="alert" className="admin__error">{friendlyError(error)}</p>}
      <form className="admin__form" onSubmit={add}>
        <label>
          Class name
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Archetype
          <select aria-label="New class archetype" value={archetype} onChange={(e) => setArchetype(e.target.value as Arch)}>
            <ArchetypeOptions />
          </select>
        </label>
        <div className="admin__row">
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>Add class</button>
        </div>
      </form>
      <table className="admin__table">
        <thead>
          <tr><th>Class</th><th>Archetype</th><th /></tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id}>
              <td data-label="Class">{c.name}</td>
              <td data-label="Archetype">
                <select
                  aria-label={`Archetype for ${c.name}`}
                  value={c.archetype}
                  // Only the row being saved waits; a second change can't race the first.
                  disabled={update.isPending && update.variables?.id === c.id}
                  onChange={(e) => update.mutate({ id: c.id, archetype: e.target.value as Arch })}
                >
                  <ArchetypeOptions />
                </select>
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn--danger"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => { if (window.confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
