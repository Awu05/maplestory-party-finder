import { useEffect, useState } from 'react';
import type { CharacterDTO, RarityTierDTO } from '@pf/shared';
import { useRarityTiers, useSaveTiers } from '../../api/hooks';
import { friendlyError } from '../../api/errors';
import { CharacterCard } from '../../components/card/CharacterCard';

interface Row {
  name: string;
  minCp: string;
  sortOrder: string;
}

const sample = (combatPower: number): CharacterDTO => ({
  id: 'sample',
  ign: 'SampleHero',
  world: { id: 0, name: 'Scania' },
  jobName: 'Hero',
  archetype: 'warrior',
  level: 275,
  imageUrl: '',
  combatPower,
  cpUpdatedAt: '2026-01-01T00:00:00.000Z',
  guild: { id: 'sample', name: 'Sample Guild', iconUrl: null },
  manual: false,
  screenshotUrl: null,
  owner: { discordUsername: 'sample', displayName: null },
  isOwner: false,
  syncStatus: 'ok',
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
});

export function TiersAdmin() {
  const tiers = useRarityTiers();
  const save = useSaveTiers();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (tiers.data) {
      setRows(tiers.data.map((t) => ({ name: t.name, minCp: String(t.minCp), sortOrder: String(t.sortOrder) })));
    }
  }, [tiers.data]);

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const parsed = rows.map((r) => ({ name: r.name, minCp: Number(r.minCp), sortOrder: Number(r.sortOrder) }));
  const draftTiers: RarityTierDTO[] = parsed.map((t, i) => ({ id: i, ...t }));

  return (
    <div>
      <h2>Rarity tiers</h2>
      <form
        className="admin__form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(parsed);
        }}
      >
        {rows.map((r, i) => (
          <div className="admin__row" key={i}>
            <label>
              Name
              <input required value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
            </label>
            <label>
              Min CP
              <input type="number" min={0} required value={r.minCp} onChange={(e) => setRow(i, { minCp: e.target.value })} />
            </label>
            <label>
              Order
              <input type="number" required value={r.sortOrder} onChange={(e) => setRow(i, { sortOrder: e.target.value })} />
            </label>
            <button type="button" className="btn btn--secondary" aria-label={`Remove tier ${r.name || i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        {save.isError && <p role="alert" className="admin__error">{friendlyError(save.error)}</p>}
        {save.isSuccess && <p role="status">Saved.</p>}
        <div className="admin__row">
          <button type="button" className="btn btn--secondary" onClick={() => setRows([...rows, { name: '', minCp: '0', sortOrder: String(rows.length) }])}>
            Add tier
          </button>
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>Save tiers</button>
        </div>
      </form>

      <h3>Preview</h3>
      <div className="admin__previews">
        {draftTiers.map((t) => (
          <figure key={t.id}>
            <CharacterCard character={sample(t.minCp)} tiers={draftTiers} />
            <figcaption>{t.name} at {t.minCp.toLocaleString()} CP</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
