import type { BossDTO } from '@pf/shared';
import { bossIconUrl } from './bossIcons';

interface Props {
  value: number[];
  onChange: (v: number[]) => void;
  bosses: BossDTO[];
  max: number;
}

export function BossMultiPicker({ value, onChange, bosses, max }: Props) {
  const full = value.length >= max;
  const toggle = (id: number, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id));

  return (
    <div className="boss-picker panel">
      <p className="boss-picker__count">{`${value.length}/${max} selected`}</p>
      {bosses.map((boss) => (
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
                  disabled={full && !checked}
                  onChange={(e) => toggle(d.id, e.target.checked)}
                />{' '}
                {d.difficulty}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
