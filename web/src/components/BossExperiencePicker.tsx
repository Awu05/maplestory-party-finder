import { EXPERIENCE_LABELS } from '@pf/shared';
import type { BossDTO, ExperienceLevel } from '@pf/shared';

export interface BossSelection {
  bossDifficultyId: number;
  experience: ExperienceLevel;
}

interface Props {
  value: BossSelection[];
  onChange: (v: BossSelection[]) => void;
  bosses: BossDTO[];
}

const LEVELS = Object.keys(EXPERIENCE_LABELS) as ExperienceLevel[];

export function BossExperiencePicker({ value, onChange, bosses }: Props) {
  const find = (id: number) => value.find((v) => v.bossDifficultyId === id);
  const toggle = (id: number, on: boolean) =>
    onChange(on ? [...value, { bossDifficultyId: id, experience: 'learning' }] : value.filter((v) => v.bossDifficultyId !== id));
  const setExp = (id: number, experience: ExperienceLevel) =>
    onChange(value.map((v) => (v.bossDifficultyId === id ? { ...v, experience } : v)));

  return (
    <div className="boss-picker">
      {bosses.map((boss) => (
        <fieldset key={boss.id} className="boss-picker__row">
          <legend>{boss.name}</legend>
          {boss.difficulties.map((d) => {
            const sel = find(d.id);
            const name = `${d.difficulty} ${boss.name}`;
            return (
              <span key={d.id} className="boss-picker__diff">
                <label>
                  <input
                    type="checkbox"
                    aria-label={name}
                    checked={!!sel}
                    onChange={(e) => toggle(d.id, e.target.checked)}
                  />{' '}
                  {d.difficulty}
                </label>
                {sel && (
                  <select
                    aria-label={`Experience for ${name}`}
                    value={sel.experience}
                    onChange={(e) => setExp(d.id, e.target.value as ExperienceLevel)}
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {EXPERIENCE_LABELS[l]}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
