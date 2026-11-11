import { useState } from 'react';
import type { ReactNode } from 'react';
import type { BossDTO } from '@pf/shared';
import { bossIconUrl } from './bossIcons';
import { groupBossesByArea } from './bossAreas';

interface Props {
  value: number[];
  onChange: (v: number[]) => void;
  bosses: BossDTO[];
}

function BossArea({ name, bossCount, selectedCount, children }: { name: string; bossCount: number; selectedCount: number; children: ReactNode }) {
  // Keep the initial open prop stable so native disclosure choices survive selection updates.
  const [initiallyOpen] = useState(selectedCount > 0);
  return (
    <details className="boss-picker__area" open={initiallyOpen}>
      <summary>
        <span className="boss-picker__area-name">{name}</span>
        <span className="boss-picker__area-count">{bossCount} {bossCount === 1 ? 'boss' : 'bosses'}</span>
        {selectedCount > 0 && <span className="boss-picker__area-selected">{selectedCount} selected</span>}
      </summary>
      <div className="boss-picker__area-grid">{children}</div>
    </details>
  );
}

export function BossMultiPicker({ value, onChange, bosses }: Props) {
  const toggle = (id: number, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));

  return (
    <div className="boss-picker panel">
      <p className="boss-picker__count">{`${value.length} selected`}</p>
      <p className="boss-picker__hint">Expand an area to choose bosses and difficulties.</p>
      {groupBossesByArea(bosses).map((area) => (
        <BossArea key={area.name} name={area.name} bossCount={area.bosses.length}
          selectedCount={area.bosses.reduce((count, boss) => count + boss.difficulties.filter((d) => value.includes(d.id)).length, 0)}>
          {area.bosses.map((boss) => (
            <fieldset key={boss.id} className="boss-picker__row">
              <legend>
                <span className="boss-picker__name">
                  {bossIconUrl(boss) && (
                    <img
                      className="boss-picker__icon"
                      src={bossIconUrl(boss)}
                      alt=""
                      width={32}
                      height={32}
                      loading="lazy"
                      onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                    />
                  )}
                  {boss.name}
                </span>
              </legend>
              {boss.difficulties.map((d) => {
                const checked = value.includes(d.id);
                return (
                  <label key={d.id} className="boss-picker__diff">
                    <input
                      type="checkbox"
                      aria-label={`${d.difficulty} ${boss.name}`}
                      checked={checked}
                      onChange={(e) => toggle(d.id, e.target.checked)}
                    />{' '}
                    {d.difficulty}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </BossArea>
      ))}
    </div>
  );
}
