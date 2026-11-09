import { useState } from 'react';
import type { BossDTO } from '@pf/shared';
import { useBosses, useCreateBoss, useDeleteBoss, useUpdateBoss } from '../../api/hooks';
import { friendlyError } from '../../api/errors';

interface Row {
  difficulty: string;
  partyCap: string;
}

function BossEditor({ boss }: { boss?: BossDTO }) {
  const create = useCreateBoss();
  const update = useUpdateBoss();
  const remove = useDeleteBoss();
  const [name, setName] = useState(boss?.name ?? '');
  const [rows, setRows] = useState<Row[]>(
    boss?.difficulties.map((d) => ({ difficulty: d.difficulty, partyCap: String(d.partyCap) })) ?? [],
  );
  const error = create.error ?? update.error ?? remove.error;

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name,
      difficulties: rows.map((r, i) => ({ difficulty: r.difficulty, partyCap: Number(r.partyCap), sortOrder: i })),
    };
    if (boss) update.mutate({ id: boss.id, ...payload });
    else
      create.mutate(payload, {
        onSuccess: () => {
          setName('');
          setRows([]);
        },
      });
  }

  return (
    <form className="admin__card" onSubmit={save} aria-label={boss?.name ?? 'New boss'}>
      <label>
        Boss name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {rows.map((r, i) => (
        <div className="admin__row" key={i}>
          <label>
            Difficulty
            <input required value={r.difficulty} onChange={(e) => setRow(i, { difficulty: e.target.value })} />
          </label>
          <label>
            Party cap
            <input type="number" min={1} required value={r.partyCap} onChange={(e) => setRow(i, { partyCap: e.target.value })} />
          </label>
          <button type="button" aria-label={`Remove difficulty ${r.difficulty || i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      {error && <p role="alert" className="admin__error">{friendlyError(error)}</p>}
      <div className="admin__row">
        <button type="button" onClick={() => setRows([...rows, { difficulty: '', partyCap: '6' }])}>Add difficulty</button>
        <button type="submit">{boss ? 'Save boss' : 'Create boss'}</button>
        {boss && (
          <button type="button" onClick={() => { if (window.confirm(`Delete ${boss.name}?`)) remove.mutate(boss.id); }}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

export function BossesAdmin() {
  const bosses = useBosses();
  return (
    <div>
      <h2>Bosses</h2>
      {bosses.isError && <p role="alert" className="admin__error">{friendlyError(bosses.error)}</p>}
      {bosses.data?.map((b) => <BossEditor key={b.id} boss={b} />)}
      <h3>Add boss</h3>
      <BossEditor />
    </div>
  );
}
